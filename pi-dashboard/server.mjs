#!/usr/bin/env node
// @why: [2026-09-03] ユーザー要望「web で総合監視したい。全てのタブを。log の copy と通知」。
//   wezterm で並走する複数 pi の状態（busy/入力待ち/エラー）とログを、ブラウザ 1 画面でリアルタイム監視する
//   ローカルサーバー。依存ゼロ（Node 標準 http のみ）+ SSE プッシュ + 受信ログの JSONL 永続化で
//   「全タブのログコピー」を実現する。監視サーバーの正本は yume-kit/pi-dashboard/ に置く。
// @tags: SPEC

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const PORT = Number(process.env.PI_DASHBOARD_PORT ?? 8787);
// @why: ログのコピー先は pi 自身の session JSONL を壊さない独立ディレクトリに置く（DO_NOT 方針）。
//   ~/.pi/agent/dashboard/panes/<paneId>.jsonl に 1 行=1 エントリで追記する。
// @why: テスト時にホームを汚さないよう PI_DASHBOARD_DATA で保存先を差し替えられるようにする。
// @why: [2026-09-06] DATA_DIR をモジュールトップレベルで解決していたため、テストが import 後に PI_DASHBOARD_DATA を
//       設定しても効かず、実ホーム（~/.pi/agent/dashboard）へ書き込んでいた（テスト5 失敗 + 実データ汚染の原因）。
//       ESM import は実行前に解決されるため、環境変数を差し替えるには毎回解決する関数にする必要がある。
function resolveDataDir() {
  return process.env.PI_DASHBOARD_DATA ?? path.join(os.homedir(), ".pi", "agent", "dashboard");
}

// SSE の keepalive 間隔（ms）。プロキシやブラウザのアイドル切断を防ぐ。
const KEEPALIVE_MS = 25000;

// ============ 集中管理チャット（conductor） ============
// @why: [2026-09-06] ユーザー要望「俺と集中管理LLMが会話し、LLMが各端末へ指示を送る（俺との会話の結果）」。
//   監視だけでなくチャットからオーケストレーターLLM（OpenRouter）を呼び、応答 JSON の actions を
//   wezterm の各 pane へ send-text で投入する。タブの識別は既存の WEZTERM_PANE（paneId）を使うため、
//   LLMが指定する target も同じ paneId で一致する。依存を増やさない（fetch + execFile のみ）。
const CONDUCTOR_MODEL = process.env.PI_DASHBOARD_MODEL ?? "deepseek/deepseek-v4-flash-0731";
const WEZTERM_BIN = process.env.WEZTERM_BIN ?? "/Applications/WezTerm.app/Contents/MacOS/wezterm";
const CHAT_PERSIST_FILE = "chat.jsonl";
// @why: [2026-09-06] 集中管理センターから新しい wezterm タブ（＝新しい pi）を開けるようにする。
//   wezterm cli spawn でタブを開き、その中で pi を起動する。既定の作業ディレクトリは pi_root。
const DEFAULT_TAB_CWD = process.env.PI_DASHBOARD_TAB_CWD ?? "/Users/AoyamaRito/pi_root";
const TAB_COMMAND = process.env.PI_DASHBOARD_TAB_COMMAND ?? "pi";
/** 会話履歴（メモリ）。永続は chat.jsonl にも追記する。role/kind: user | assistant | action | error */
const chatHistory = [];

/** OpenRouter のキーは環境変数を優先し、無ければ pi の auth.json（openrouter）から引く。 */
function getConductorKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi", "agent", "auth.json"), "utf8"));
    const k = auth?.openrouter?.key;
    if (typeof k === "string" && k) return k;
  } catch {}
  return null;
}

/** チャット履歴を永続化（chat.jsonl）。メモリ上限 500 件、ファイルは無制限。 */
function pushChat(entry) {
  entry.ts = entry.ts ?? Date.now();
  chatHistory.push(entry);
  if (chatHistory.length > 500) chatHistory.shift();
  try {
    fs.mkdirSync(resolveDataDir(), { recursive: true });
    fs.appendFileSync(path.join(resolveDataDir(), CHAT_PERSIST_FILE), JSON.stringify(entry) + "\n");
  } catch {}
}

/** 永続JSONLからチャット履歴を遡って読む（リロード再開用）。 */
function loadChatHistory(max = 200) {
  try {
    const f = path.join(resolveDataDir(), CHAT_PERSIST_FILE);
    if (!fs.existsSync(f)) return [];
    return fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-max);
  } catch {
    return [];
  }
}

/** LLM の素の応答から JSON を取り出す（```json...``` 囲みや前後ノイズを許容）。 */
function parseMaybeJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cand = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(cand);
  } catch {}
  // 最初の { から最後の } までで再試行
  const i = cand.indexOf("{");
  const j = cand.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      return JSON.parse(cand.slice(i, j + 1));
    } catch {}
  }
  return null;
}

/** オーケストレーターLLM（OpenRouter）を呼ぶ。返る形: { reply, actions:[{target,text}] } */
async function callConductorLLM(text, history) {
  const key = getConductorKey();
  if (!key) throw new Error("OpenRouter key not found (auth.json / OPENROUTER_API_KEY)");
  const panesInfo = [...panes.values()].map((p) => ({
    paneId: p.paneId,
    title: p.title,
    state: p.state,
    cost: p.cost,
    recent: p.lines.slice(-3).map((l) => ({ kind: l.kind, role: l.role, text: (l.text || "").slice(0, 80) })),
  }));
  const sys = `あなたは wezterm で並走する複数 pi を一元管理する「集中管理センター」のオーケストレーターです。
ユーザー（管理者）の全体指示を分析し、どの pi タブに何の仕事を投げるかを決めてください。
必ず以下の JSON だけを返してください（JSON 以外の文章を書かないこと）:
{"reply": "ユーザーへの状況報告・進め方（自然な日本語）", "actions": [{"target": "paneId または all", "text": "その pi に送る指示文"}], "view": {"type": "terminal", "paneId": "..."} または {"type": "image", "path": "/絶対パス"} または null, "openTab": {"cwd": "/作業ディレクトリ"} または null, "command": "実行するシェルコマンド" または null}

注意:
- 各 paneId は下記監視タブから選んでください。複数タブに振るときは actions を複数入れてください。
- state が busy（実行中）のタブへは指示を送らないでください。忙しいタブに振りたい場合は reply で「◯◯が実行中」と伝え、idle のタブに振るか待ってください。
- どのタブにも送る必要がなければ "actions": [] にしてください（返すことは返してください）。
- text は相手 pi にそのまま人間の入力として渡ります。「やってほしい作業内容」を具体的・明示に。
- ユーザーがターミナルの様子を見たいと言ったら view に {"type":"terminal","paneId":"..."} を、画像ファイルを見たいと言ったら {"type":"image","path":"/絶対パス"} を入れてください。不要なら view は null にしてください。
- 新しいタブ（新しい pi）が必要なときは openTab に {"cwd": "/作業ディレクトリ"} を入れてください。不要なら null にしてください。
- ユーザーがコマンド実行を求めたら command にシェルコマンドを入れてください（例: "ls -la"）。不要なら null にしてください。
- ユーザーが「pi を実行」「pi にやらせる」と言ったら、command に pi の非対話実行を入れてください（例: "pi 'タスク内容'"）。pi は対話型 TUI なので、必ず引数でメッセージを渡してください。

監視中のタブ:
${JSON.stringify(panesInfo)}
`;
  const messages = [
    { role: "system", content: sys },
    ...history.slice(-30).map((h) => ({ role: h.kind === "assistant" ? "assistant" : "user", content: String(h.content) })),
    { role: "user", content: text },
  ];
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: CONDUCTOR_MODEL, messages, temperature: 0.4 }),
    signal: AbortSignal.timeout(90000),
  });
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const parsed = parseMaybeJson(content);
  if (parsed && typeof parsed === "object") {
    return {
      reply: String(parsed.reply ?? parsed.message ?? content).trim(),
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      view: parsed.view ?? null,
      openTab: parsed.openTab ?? null,
      command: parsed.command ?? null,
    };
  }
  // JSON でない応答: 全文を reply として返し、操作は行わない
  return { reply: content.trim() || "（応答がありませんでした）", actions: [], view: null, openTab: null, command: null };
}

/** wezterm の pane へテキスト投入（指示の実行）。Enter("\r") を末尾に付けて確定させる。 */
function execTermSend(paneId, commandText) {
  return new Promise((resolve) => {
    execFile(
      WEZTERM_BIN,
      ["cli", "send-text", "--pane-id", String(paneId), "--no-paste", commandText + "\r"],
      { timeout: 8000 },
      (err) => resolve(err ? { ok: false, error: err.message } : { ok: true })
    );
  });
}

/** 新しい wezterm タブで pi を起動する（集中管理センターからタブを開く）。 */
// @why: [2026-09-06] ユーザー要望「タブを開けるように修正」。wezterm cli spawn でタブを開き、
//       その中で pi を起動する。cwd は body.cwd で指定可（既定は pi_root）。
function openTab(cwd) {
  return new Promise((resolve) => {
    execFile(
      WEZTERM_BIN,
      ["cli", "spawn", "--cwd", cwd, "--", TAB_COMMAND],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) return resolve({ ok: false, error: err.message });
        const paneId = String(stdout || "").trim();
        resolve({ ok: true, paneId, cwd });
      }
    );
  });
}

/** シェルコマンドを実行して結果を返す（集中管理 LLM の command 実行）。 */
// @why: [2026-09-06] ユーザー要望「コマンドも実行できるといい」。LLM の応答 JSON の command を
//       サーバー側で実行し、出力をチャットに表示する。タイムアウト・出力上限で暴走を防ぐ。
const COMMAND_TIMEOUT_MS = 30000;
const COMMAND_MAX_OUTPUT = 4000;
function execCommand(command) {
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", command], { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: err.message, stdout: String(stdout || "").slice(0, COMMAND_MAX_OUTPUT), stderr: String(stderr || "").slice(0, COMMAND_MAX_OUTPUT) });
        return;
      }
      resolve({ ok: true, stdout: String(stdout || "").slice(0, COMMAND_MAX_OUTPUT), stderr: String(stderr || "").slice(0, COMMAND_MAX_OUTPUT) });
    });
  });
}

/** アクションを実行する。target='all' は全登録パネ。busy は対象外（システムBLOCK内で説明済み）。 */
async function runAction(action) {
  const text = String(action.text ?? action.action ?? "").trim();
  if (!text) return { target: action.target, ok: false, error: "text empty" };
  const targets = action.target === "all" ? [...panes.keys()] : String(action.target ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (const t of targets) {
    if (!panes.has(t)) {
      results.push({ target: t, ok: false, error: "unknown pane" });
      continue;
    }
    const r = await execTermSend(t, text);
    results.push({ target: t, ok: r.ok, error: r.ok ? undefined : r.error });
  }
  return { ok: results.every((r) => r.ok), results };
}

/** chat 処理本体（POST /api/chat から呼ぶ）。結果は SSE で流す。 */
// テストから LLM 呼び出し・wezterm 送信を偽装できるよう、実装を変数で間接化する。
// @why: [2026-09-06] LLM 呼び出しは実ネットワーク・実キーに依存するため、テストでは
//       __testOverride でモックに差し替えて「チャット→actions→送信」の一連の契約を検証できるようにする。
let llmImpl = callConductorLLM;
let runActionImpl = runAction;
let summarizeImpl = callSummarizeLLM;
let viewImpl = handleView;
let openTabImpl = openTab;
let execCommandImpl = execCommand;
export function __testOverrideLLM({ llm, sendAction, summarize, view, openTab: ot, command: cmd }) {
  if (llm) llmImpl = llm;
  if (sendAction) runActionImpl = sendAction;
  if (summarize) summarizeImpl = summarize;
  if (view) viewImpl = view;
  if (ot) openTabImpl = ot;
  if (cmd) execCommandImpl = cmd;
}
/** テストから SSE 配信を直接呼ぶためのフック（view モック内で使う）。 */
export function __testBroadcast(event) {
  broadcast(event);
}
async function handleChat(body) {
  const text = String(body?.text ?? "").trim();
  if (!text) return { ok: false, error: "text required" };
  autonomy.consecutive = 0; // ユーザー指示で自律連続カウントをリセット（新しい指示が最優先）
  pushChat({ kind: "user", content: text });
  broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
  broadcast({ type: "chat", entry: { kind: "typing", ts: Date.now() } });
  try {
    const res = await llmImpl(text, [...chatHistory]);
    if (res.view) viewImpl(res.view);
    // LLM が新しいタブを開く指示を出したら実行する（openTab）
    if (res.openTab) {
      const cwd = String(res.openTab.cwd ?? DEFAULT_TAB_CWD).trim() || DEFAULT_TAB_CWD;
      const r = await openTabImpl(cwd);
      const msg = r.ok ? `🆕 新しいタブを開きました（pane ${r.paneId} / ${cwd}）` : `⚠ タブを開けませんでした: ${r.error ?? ""}`;
      pushChat({ kind: "action", content: msg, sent: r, ts: Date.now() });
      broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    }
    // LLM がコマンド実行を指示したら実行する（command）
    if (res.command) {
      const cmd = String(res.command).trim();
      const r = await execCommandImpl(cmd);
      const out = r.ok ? (r.stdout || "（出力なし）") : `エラー: ${r.error ?? ""}${r.stderr ? "\n" + r.stderr : ""}`;
      const msg = `💻 コマンド実行: ${cmd}\n\`\`\`\n${out.slice(0, 1500)}\n\`\`\``;
      pushChat({ kind: "action", content: msg, sent: r, ts: Date.now() });
      broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    }
    for (const a of res.actions) {
      const sent = await runActionImpl(a);
      const items = sent.results ?? [{ target: sent.target, ok: sent.ok, error: sent.error }];
      const summary = items.map((r) => `${r.target}${r.ok ? "✓" : "✗ " + (r.error ?? "")}`).join("，");
      pushChat({ kind: "action", content: `→ 送信: ${summary}`, sent, ts: Date.now() });
      broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    }
    pushChat({ kind: "assistant", content: res.reply });
    broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    return { ok: true };
  } catch (e) {
    const msg = `集中管理の呼び出しに失敗しました: ${String(e?.message ?? e)}`;
    pushChat({ kind: "error", content: msg });
    broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    return { ok: false, error: msg };
  }
}

// ============ タブ作業タイトル（summary） ============
// @why: [2026-09-06] ユーザー要望「作業内容のまとめを各タブのトップにタイトルとして」。
//   タブが busy→idle になった時に直近ログから LLM で短い作業タイトルを生成し、カードのタイトルに表示する。
//   コスト抑制のためタブごと 60 秒間隔制限 + 要約は 20 字程度の短いタイトルのみ。
const SUMMARY_MIN_INTERVAL_MS = 60000;
const summaryByPane = {}; // paneId -> lastAt

/** 要約用 LLM 呼び出し（短い作業タイトルを返す）。 */
async function callSummarizeLLM(paneId) {
  const key = getConductorKey();
  if (!key) throw new Error("OpenRouter key not found");
  const pane = panes.get(paneId);
  if (!pane) return "";
  const recent = pane.lines
    .slice(-10)
    .map((l) => `${l.role ?? l.kind}: ${(l.text || "").slice(0, 200)}`)
    .join("\n");
  const sys = `あなたは各 pi タブの作業内容を要約するアシスタントです。
以下のログから、このタブが「今やっている作業」を 20 字以内の日本語の短いタイトルに要約してください。
タイトルだけを返してください（JSON 不要・装飾不要・改行不要・必ず日本語で）。
ログが空または作業内容が不明な場合は「（作業なし）」と返してください。

ログ:
${recent}`;
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: CONDUCTOR_MODEL,
      messages: [{ role: "system", content: sys }],
      temperature: 0.2,
      // @why: [2026-09-06] 実測で summary が空になる原因。max_tokens:60 が小さすぎて reasoning モデル
      //       （deepseek-v4-flash）が reasoning にトークンを使い切り最終応答が空になっていた。
      //       200 に増やして最終応答を確保する。
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  // @why: [2026-09-06] 実測で content が空のまま。reasoning モデルは content が空で reasoning に
  //       応答が入ることがあるため、フォールバックで reasoning を使う。
  const reasoning = data?.choices?.[0]?.message?.reasoning ?? "";
  const result = (content || reasoning).trim().replace(/^["']|["']$/g, "").slice(0, 40);
  // @why: [2026-09-06] 要約の動作確認用の軽量ログ（毎回の要約で出る）。
  console.log(`[pi-dashboard] summarize(${paneId}) ->`, JSON.stringify(result));
  return result;
}

/** タブの作業タイトルを生成して pane.summary に反映（fire-and-forget・間隔制限付き）。 */
async function summarizePane(paneId) {
  const now = Date.now();
  if (now - (summaryByPane[paneId] ?? 0) < SUMMARY_MIN_INTERVAL_MS) return;
  summaryByPane[paneId] = now;
  try {
    const summary = await summarizeImpl(paneId);
    const pane = panes.get(paneId);
    if (pane && summary) {
      pane.summary = summary;
      broadcast({ type: "pane", pane: { paneId, title: pane.title, summary, state: pane.state, cost: pane.cost } });
    }
  } catch (e) {
    // 要約失敗は静かに無視（次回の idle で再試行）
    // @why: [2026-09-06] 実測で summary が生成されない問題の調査用。エラーをログに残す（本番でも軽量）。
    console.error(`[pi-dashboard] summarizePane(${paneId}) failed:`, e?.message ?? e);
  }
}

// ============ 集中管理ビュー（view） ============
// @why: [2026-09-06] ユーザー要望「集中管理センターのAIが view に一時的に各ターミナルの様子や画像ファイルを見せられるように」。
//   LLM の応答 JSON の view フィールド（{type:"terminal",paneId} / {type:"image",path}）を受け取り、
//   wezterm get-text でターミナル内容を取得、または画像ファイルを data URL 化して SSE で配信する。
const VIEW_MAX_TEXT = 4000; // ターミナル表示の最大文字数

/** wezterm の pane からターミナル内容を取得する。 */
function execTermGetText(paneId) {
  return new Promise((resolve) => {
    execFile(WEZTERM_BIN, ["cli", "get-text", "--pane-id", String(paneId)], { timeout: 8000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve(err ? { ok: false, error: err.message } : { ok: true, text: stdout });
    });
  });
}

/** view を処理して SSE で配信する（fire-and-forget）。 */
async function handleView(view) {
  if (!view || typeof view !== "object") return;
  const type = view.type;
  if (type === "terminal") {
    const paneId = String(view.paneId ?? "");
    if (!paneId) return;
    const r = await execTermGetText(paneId);
    const text = r.ok ? r.text.slice(0, VIEW_MAX_TEXT) : `（取得失敗: ${r.error}）`;
    broadcast({ type: "view", view: { type: "terminal", paneId, text, at: Date.now() } });
  } else if (type === "image") {
    const p = String(view.path ?? "");
    if (!p) return;
    try {
      const buf = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase().replace(".", "") || "png";
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] ?? "application/octet-stream";
      broadcast({ type: "view", view: { type: "image", path: p, dataUrl: `data:${mime};base64,${buf.toString("base64")}`, at: Date.now() } });
    } catch (e) {
      broadcast({ type: "view", view: { type: "image", path: p, error: String(e?.message ?? e), at: Date.now() } });
    }
  }
}

// ============ 自律モード（autonomy） ============
// @why: [2026-09-06] ユーザー要望「コイツは自律的に動けるようにしてほしい」。
//   タブが busy→idle になったら集中管理LLMに「次にやるべきこと」を自動で問い、actions があれば送信する。
//   暴走防止: デフォルトOFF・全体送信間隔・タブごとチェック間隔・連続送信上限（ユーザー指示でリセット）。
const AUTONOMY_MIN_INTERVAL_MS = 30000;   // 自律送信の全体間隔（30秒）
const AUTONOMY_CHECK_INTERVAL_MS = 60000; // 同じタブへの自律チェック間隔（60秒）
const AUTONOMY_MAX_CONSECUTIVE = 5;        // ユーザー指示なしでの連続自律送信上限
const autonomy = { enabled: false, lastSendAt: 0, lastCheckByPane: {}, consecutive: 0 };

function autonomyStatus() {
  return { enabled: autonomy.enabled, lastSendAt: autonomy.lastSendAt, consecutive: autonomy.consecutive };
}

/** タブが待機になった時の自律チェック（fire-and-forget）。 */
async function autonomyCheck(paneId) {
  if (!autonomy.enabled) return;
  const now = Date.now();
  if (now - autonomy.lastSendAt < AUTONOMY_MIN_INTERVAL_MS) return;
  if (now - (autonomy.lastCheckByPane[paneId] ?? 0) < AUTONOMY_CHECK_INTERVAL_MS) return;
  if (autonomy.consecutive >= AUTONOMY_MAX_CONSECUTIVE) return;
  autonomy.lastCheckByPane[paneId] = now;
  try {
    const res = await llmImpl(
      `タブ ${paneId}（${panes.get(paneId)?.title ?? ""}）が作業を終えて待機状態になりました。` +
        `現在の状況と進行中のタスクを踏まえて、このタブに次にやるべき作業があれば actions で指示してください。` +
        `なければ actions を空にしてください。`,
      [...chatHistory]
    );
    if (res.actions.length === 0 && !res.openTab) return; // やることがなければ静かに待つ
    if (res.view) viewImpl(res.view);
    // 自律でも新しいタブを開ける（openTab）
    if (res.openTab) {
      const cwd = String(res.openTab.cwd ?? DEFAULT_TAB_CWD).trim() || DEFAULT_TAB_CWD;
      const r = await openTabImpl(cwd);
      const msg = r.ok ? `[自律] 🆕 新しいタブを開きました（pane ${r.paneId} / ${cwd}）` : `[自律] ⚠ タブを開けませんでした: ${r.error ?? ""}`;
      pushChat({ kind: "action", content: msg, sent: r, ts: Date.now() });
      broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    }
    for (const a of res.actions) {
      const sent = await runActionImpl(a);
      const items = sent.results ?? [{ target: sent.target, ok: sent.ok, error: sent.error }];
      const summary = items.map((r) => `${r.target}${r.ok ? "✓" : "✗ " + (r.error ?? "")}`).join("，");
      pushChat({ kind: "action", content: `[自律] → 送信: ${summary}`, sent, ts: Date.now() });
      broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    }
    pushChat({ kind: "assistant", content: `[自律] ${res.reply}`, ts: Date.now() });
    broadcast({ type: "chat", entry: chatHistory[chatHistory.length - 1] });
    autonomy.lastSendAt = Date.now();
    autonomy.consecutive++;
  } catch {
    // 自律チェックの失敗は静かに無視（次回の idle で再試行される）
  }
}
// インメモリで保持するパネごとの表示用ログ行数の上限（永続 JSONL は無制限）。
const MAX_LINES = 200;

/** paneId -> { paneId, title, session, cwd, state, cost, lines[], lastAt } */
const panes = new Map();

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function paneFile(paneId) {
  return path.join(resolveDataDir(), "panes", sanitizeId(paneId) + ".jsonl");
}

/** 存在しなければパネを作り、受信した partial 情報で初期化する。 */
function getPane(paneId, partial = {}) {
  let p = panes.get(paneId);
  if (!p) {
    p = {
      paneId,
      title: partial.title ?? paneId,
      session: partial.session ?? "",
      cwd: partial.cwd ?? "",
      state: "idle",
      cost: 0,
      summary: "",
      lines: [],
      lastAt: Date.now(),
    };
    panes.set(paneId, p);
  }
  return p;
}

/** パネの表示用ログ行を追加し、永続 JSONL にも追記する（＝ログのコピー）。 */
function pushLine(pane, entry) {
  entry.ts = entry.ts ?? Date.now();
  pane.lines.push(entry);
  if (pane.lines.length > MAX_LINES) pane.lines.shift();
  pane.lastAt = entry.ts;
  // @why: [2026-09-06] fs.appendFile（非同期）だとレスポンス後に書き込みが未完了のままで、
  //       「受け取ったログが必ず JSONL に実体として残る」契約が保証できない（テスト5 が空ファイルで失敗）。
  //       監視ログは 1 行 = 小さな書き込みで高頻度でもないため、同期書き込みで完了を保証する。
  fs.appendFileSync(paneFile(pane.paneId), JSON.stringify(entry) + "\n");
}

/** GET /state 用：表示に足りるライトな全状態（lines は tail のみ）。 */
function fullPane(p) {
  return {
    paneId: p.paneId,
    title: p.title,
    summary: p.summary ?? "",
    session: p.session,
    cwd: p.cwd,
    state: p.state,
    cost: p.cost,
    lastAt: p.lastAt,
    lines: p.lines.slice(-20),
  };
}

/** SSE 購読者へ状態・ログの差分をプッシュする。 */
function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}

/** @why: クライアント集合はプロセス内で共有される（シングルユーザー・ローカル想定）。 */
const clients = new Set();

function handleIngest(body) {
  if (!body || !body.paneId) return { ok: false, error: "paneId required" };
  const pane = getPane(body.paneId, body);

  if (body.kind === "register") {
    pane.title = body.title ?? pane.title;
    pane.cwd = body.cwd ?? pane.cwd;
    pane.session = body.session ?? pane.session;
    broadcast({
      type: "pane",
      pane: { paneId: pane.paneId, title: pane.title, cwd: pane.cwd, session: pane.session, state: pane.state, cost: pane.cost },
    });
    return { ok: true };
  }

  if (body.kind === "state") {
    const prev = pane.state;
    pane.state = body.state ?? pane.state;
    const entry = { ts: Date.now(), kind: "state", state: pane.state };
    pushLine(pane, entry);
    broadcast({ type: "state", paneId: pane.paneId, prev, state: pane.state, at: entry.ts });
    // 自律モード: busy→idle で次にやるべきことを自動判断（fire-and-forget）
    if (pane.state === "idle" && prev === "busy") {
      autonomyCheck(pane.paneId);
      summarizePane(pane.paneId);
    }
    return { ok: true };
  }

  if (body.kind === "log") {
    if (typeof body.cost === "number" && Number.isFinite(body.cost)) {
      pane.cost = Number((pane.cost + body.cost).toFixed(8));
    }
    const entry = { ts: Date.now(), kind: "log", role: body.role ?? "system", text: body.text ?? "", cost: typeof body.cost === "number" ? body.cost : undefined };
    pushLine(pane, entry);
    broadcast({ type: "log", paneId: pane.paneId, entry });
    return { ok: true };
  }

  return { ok: false, error: "unknown kind" };
}

function route(req, res, body) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/") {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ panes: [...panes.values()].map(fullPane) }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/ingest") {
    const result = handleIngest(body);
    res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    // 処理は非同期に進み、結果は SSE（type:"chat"）で全クライアントへ流れる。
    // @why: UI は送信を fire-and-forget し、表示は SSE に一本化する（複数タブでの二重表示を防ぐ）。
    handleChat(body);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/chat/history") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ entries: loadChatHistory() }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/autonomy") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(autonomyStatus()));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/autonomy") {
    if (typeof body?.enabled === "boolean") {
      autonomy.enabled = body.enabled;
      if (body.enabled) autonomy.consecutive = 0; // 有効化で新しい自律セッション開始
      broadcast({ type: "autonomy", ...autonomyStatus() });
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(autonomyStatus()));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tab") {
    // 新しい wezterm タブで pi を起動する（集中管理センターからタブを開く）。
    // @why: [2026-09-06] ユーザー要望「タブを開けるように修正」。wezterm cli spawn でタブを開き、
    //       その中で pi を起動する。cwd は body.cwd で指定可（既定は pi_root）。
    const cwd = String(body?.cwd ?? DEFAULT_TAB_CWD).trim() || DEFAULT_TAB_CWD;
    openTabImpl(cwd)
      .then((r) => {
        res.writeHead(r.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(r));
      })
      .catch((e) => {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
      });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
}

/** サーバーを組んで返す（テストから import してランダムポートで立てられるように）。 */
export function createServer() {
  fs.mkdirSync(path.join(resolveDataDir(), "panes"), { recursive: true });

  const server = http.createServer((req, res) => {
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body = null;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          body = null;
        }
        route(req, res, body);
      });
      return;
    }
    route(req, res, null);
  });

  const keepalive = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(": keepalive\n\n");
      } catch {
        clients.delete(res);
      }
    }
  }, KEEPALIVE_MS);

  server.on("close", () => clearInterval(keepalive));

  return server;
}

// 直接実行時のみ起動する（import された場合は側で start する）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`pi-dashboard: http://localhost:${PORT}`);
  });
}