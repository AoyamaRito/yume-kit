// pi-dashboard 監視サーバーの E2E（node --test・依存ゼロ）
// @why: [2026-09-03] サーバーの公開契約（/ingest・/state・/events・永続 JSONL）を実測で固定するため。
//   テストは一時ディレクトリへ PI_DASHBOARD_DATA を差し替え、ホームの実データを汚さずに回す。
// @tags: SPEC
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, __testOverrideLLM, __testBroadcast } from "../server.mjs";

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dashboard-"));
  process.env.PI_DASHBOARD_DATA = dir;
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn({ base, dir, server });
  } finally {
    // @why: [2026-09-06] SSE テストの reader が開いたままだと server.close() がアクティブコネクションを待ち続け
    //       ハングする（実測 40 秒超でタイムアウト）。残コネクションを強制クローズしてから close を待つ。
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function ingest(base, body, headers = {}) {
  return fetch(base + "/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("GET / はダッシュボード HTML を返す", async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /pi-dashboard/);
  });
});

test("register → /state にパネが反映される", async () => {
  await withServer(async ({ base }) => {
    const r = await ingest(base, { paneId: "42", kind: "register", title: "pi_root", cwd: "/work/pi_root", session: "sess-123" });
    assert.equal(r.status, 200);
    const s = await (await fetch(base + "/state")).json();
    assert.equal(s.panes.length, 1);
    assert.equal(s.panes[0].paneId, "42");
    assert.equal(s.panes[0].title, "pi_root");
    assert.equal(s.panes[0].state, "idle");
  });
});

test("state 遷移 busy→idle が /state に反映される", async () => {
  await withServer(async ({ base }) => {
    await ingest(base, { paneId: "42", kind: "register" });
    await ingest(base, { paneId: "42", kind: "state", state: "busy" });
    // @why: [2026-09-06] panes Map はモジュール共有のため複数テストの pane が残る。先頭要素ではなく paneId で引く。
    let s = (await (await fetch(base + "/state")).json()).panes.find((p) => p.paneId === "42");
    assert.equal(s.state, "busy");
    await ingest(base, { paneId: "42", kind: "state", state: "idle" });
    s = (await (await fetch(base + "/state")).json()).panes.find((p) => p.paneId === "42");
    assert.equal(s.state, "idle");
  });
});

test("log が集約され、コストが累積される", async () => {
  await withServer(async ({ base }) => {
    await ingest(base, { paneId: "7", kind: "register" });
    await ingest(base, { paneId: "7", kind: "log", role: "user", text: "こんにちは" });
    await ingest(base, { paneId: "7", kind: "log", role: "assistant", text: "はい", cost: 0.1 });
    await ingest(base, { paneId: "7", kind: "log", role: "assistant", text: "どうぞ", cost: 0.05 });
    const s = (await (await fetch(base + "/state")).json()).panes.find((p) => p.paneId === "7");
    assert.equal(s.cost, 0.15);
    const logs = s.lines.filter((e) => e.kind === "log");
    assert.equal(logs.length, 3);
    assert.equal(logs[0].role, "user");
  });
});

test("受信ログが JSONL に永続化される（ログのコピー）", async () => {
  await withServer(async ({ base, dir }) => {
    await ingest(base, { paneId: "9", kind: "register" });
    await ingest(base, { paneId: "9", kind: "log", role: "assistant", text: "永続テスト", cost: 0.01 });
    const f = path.join(dir, "panes", "9.jsonl");
    assert.ok(fs.existsSync(f), "JSONL が作られる");
    const raw = fs.readFileSync(f, "utf8");
    assert.match(raw, /"kind":"log"/);
    assert.match(raw, /永続テスト/);
  });
});

test("SSE で状態イベントが配信される", async () => {
  await withServer(async ({ base }) => {
    // @why: [2026-09-06] register を購読前に済ませておく。購読後に送るのは state busy だけにして、
    //       最初の data: が state busy になるよう確定させる（pane broadcast が最初の data: だと
    //       ループがそこで break して busy を受信する前に検証が終わっていた）。
    await ingest(base, { paneId: "3", kind: "register" });
    const res = await fetch(base + "/events");
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    try {
      // 初回の ": connected" を無視して state busy の data イベントまで読む
      await ingest(base, { paneId: "3", kind: "state", state: "busy" });
      let buf = "";
      let got = false;
      for (let i = 0; i < 20 && !got; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('"state":"busy"')) got = true;
      }
      assert.ok(got, "SSE で state busy イベントを受信できる");
      assert.match(buf, /"state":"busy"/);
    } finally {
      // @why: [2026-09-06] reader を cancel しないと SSE コネクションが残り server.close をブロックする（ハング）。
      await reader.cancel();
    }
  });
});

test("paneId 欠落は 400 を返す", async () => {
  await withServer(async ({ base }) => {
    const r = await ingest(base, { kind: "register" });
    assert.equal(r.status, 400);
  });
});

test("集中管理チャット: 会話→actions 送信が履歴・JSONL に残る", async () => {
  await withServer(async ({ base, dir }) => {
    // @why: [2026-09-06] 集中管理センター対応の検証。LLM と wezterm 送信は実装をモックに差し替えて
    //       「ユーザー発言 → LLM産 actions → 各タブ送信 → 履歴/JSONL 永続」の一連の契約を固定する。
    __testOverrideLLM({
      llm: async (text) => {
        assert.equal(text, "まずAをやって");
        return {
          reply: "B と C に振り分けました",
          actions: [
            { target: "B", text: "Aをやってください" },
            { target: "C", text: "Aを確認してください" },
          ],
        };
      },
      sendAction: async (a) => ({ ok: true, results: [{ target: a.target, ok: true }] }),
    });
    try {
      const r = await fetch(base + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "まずAをやって" }),
      });
      assert.equal(r.status, 200);
      // 非同期処理（LLM→送信→履歴）の完了をポーリングで待つ
      let entries = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((s) => setTimeout(s, 50));
        entries = (await (await fetch(base + "/api/chat/history")).json()).entries;
        if (entries.some((e) => e.kind === "assistant")) break;
      }
      const kinds = entries.map((e) => e.kind);
      assert.ok(kinds.includes("user"), "user 発言が履歴に残る");
      assert.ok(kinds.includes("assistant"), "LLM 返信が履歴に残る");
      assert.ok(kinds.includes("action"), "actions 送信が履歴に残る");
      const f = path.join(dir, "chat.jsonl");
      assert.ok(fs.existsSync(f), "chat.jsonl が作られる");
      assert.match(fs.readFileSync(f, "utf8"), /振り分けました/);
    } finally {
      __testOverrideLLM({ llm: undefined, sendAction: undefined });
    }
  });
});

test("集中管理チャット: actions なし（見守り応答）でも履歴に残る", async () => {
  await withServer(async ({ base }) => {
    __testOverrideLLM({
      llm: async () => ({ reply: "お待ちください、現在 B が実行中です", actions: [] }),
      sendAction: async (a) => ({ ok: true, results: [] }),
    });
    try {
      await fetch(base + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "今どう？" }),
      });
      let entries = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((s) => setTimeout(s, 50));
        entries = (await (await fetch(base + "/api/chat/history")).json()).entries;
        if (entries.some((e) => e.kind === "assistant")) break;
      }
      assert.ok(entries.some((e) => e.kind === "assistant"));
      assert.ok(!entries.some((e) => e.kind === "action"), "actions が無ければ action 行は出ない");
    } finally {
      __testOverrideLLM({ llm: undefined, sendAction: undefined });
    }
  });
});

test("自律モード: OFF なら idle でも LLM を呼ばない", async () => {
  await withServer(async ({ base }) => {
    let called = 0;
    __testOverrideLLM({
      llm: async () => { called++; return { reply: "", actions: [] }; },
      sendAction: async () => ({ ok: true, results: [] }),
    });
    try {
      await ingest(base, { paneId: "A", kind: "register" });
      await ingest(base, { paneId: "A", kind: "state", state: "busy" });
      await ingest(base, { paneId: "A", kind: "state", state: "idle" });
      await new Promise((s) => setTimeout(s, 150));
      assert.equal(called, 0, "自律モード OFF なら idle でも LLM を呼ばない");
    } finally {
      __testOverrideLLM({ llm: undefined, sendAction: undefined });
    }
  });
});

test("自律モード: ON なら idle で自律チェック→送信が履歴に残る", async () => {
  await withServer(async ({ base }) => {
    __testOverrideLLM({
      llm: async (text) => {
        assert.match(text, /待機状態/);
        return { reply: "次の作業を振りました", actions: [{ target: "A", text: "続きをやって" }] };
      },
      sendAction: async (a) => ({ ok: true, results: [{ target: a.target, ok: true }] }),
    });
    try {
      await fetch(base + "/api/autonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      await ingest(base, { paneId: "A", kind: "register" });
      await ingest(base, { paneId: "A", kind: "state", state: "busy" });
      await ingest(base, { paneId: "A", kind: "state", state: "idle" });
      let entries = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((s) => setTimeout(s, 50));
        entries = (await (await fetch(base + "/api/chat/history")).json()).entries;
        if (entries.some((e) => e.kind === "action" && e.content.startsWith("[自律]"))) break;
      }
      assert.ok(entries.some((e) => e.kind === "action" && e.content.startsWith("[自律]")), "自律送信が履歴に残る");
      assert.ok(entries.some((e) => e.kind === "assistant" && e.content.startsWith("[自律]")), "自律判断の返答が履歴に残る");
    } finally {
      // 後始末: 自律モードを OFF に戻す（モジュール共有状態のため他テストへの影響防止）
      await fetch(base + "/api/autonomy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      __testOverrideLLM({ llm: undefined, sendAction: undefined });
    }
  });
});

test("作業タイトル: idle 遷移で要約が pane.summary に反映される", async () => {
  await withServer(async ({ base }) => {
    __testOverrideLLM({
      llm: async () => ({ reply: "", actions: [] }),
      sendAction: async () => ({ ok: true, results: [] }),
      summarize: async (paneId) => {
        assert.equal(paneId, "S");
        return "pi-dashboard の自律モード実装";
      },
    });
    try {
      await ingest(base, { paneId: "S", kind: "register" });
      await ingest(base, { paneId: "S", kind: "log", role: "user", text: "自律モードを実装して" });
      await ingest(base, { paneId: "S", kind: "state", state: "busy" });
      await ingest(base, { paneId: "S", kind: "state", state: "idle" });
      let s = null;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        s = (await (await fetch(base + "/state")).json()).panes.find((p) => p.paneId === "S");
        if (s && s.summary) break;
      }
      assert.ok(s && s.summary, "summary が pane に反映される");
      assert.equal(s.summary, "pi-dashboard の自律モード実装");
    } finally {
      __testOverrideLLM({ llm: undefined, sendAction: undefined, summarize: undefined });
    }
  });
});

test("集中管理ビュー: LLM の view が SSE で配信される（terminal）", async () => {
  await withServer(async ({ base }) => {
    __testOverrideLLM({
      llm: async () => ({ reply: "ターミナルを表示します", actions: [], view: { type: "terminal", paneId: "V" } }),
      sendAction: async () => ({ ok: true, results: [] }),
      view: async (v) => {
        assert.equal(v.type, "terminal");
        assert.equal(v.paneId, "V");
        __testBroadcast({ type: "view", view: { type: "terminal", paneId: "V", text: "$ ls\nfile.txt", at: Date.now() } });
      },
    });
    try {
      // SSE を先に購読してから chat を送る（view イベントが購読中に届くように）
      const res = await fetch(base + "/events");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let got = false;
      try {
        await fetch(base + "/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "ターミナル見せて" }),
        });
        for (let i = 0; i < 20 && !got; i++) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          if (buf.includes('"type":"view"')) got = true;
        }
        assert.ok(got, "SSE で view イベントを受信できる");
      } finally {
        await reader.cancel();
      }
    } finally {
      __testOverrideLLM({ llm: undefined, sendAction: undefined, view: undefined });
    }
  });
});

test("タブを開く: /api/tab が wezterm spawn を呼び paneId を返す", async () => {
  await withServer(async ({ base }) => {
    // @why: [2026-09-06] タブを開く機能の契約検証。実際の wezterm spawn は実行せず、
    //       openTab をモックして「cwd 指定 → spawn 呼び出し → paneId 応答」を固定する。
    let calledCwd = null;
    __testOverrideLLM({
      openTab: async (cwd) => {
        calledCwd = cwd;
        return { ok: true, paneId: "999", cwd };
      },
    });
    try {
      const r = await fetch(base + "/api/tab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/tmp/work" }),
      });
      const d = await r.json();
      assert.equal(r.status, 200);
      assert.equal(d.ok, true);
      assert.equal(d.paneId, "999");
      assert.equal(d.cwd, "/tmp/work");
      assert.equal(calledCwd, "/tmp/work", "指定 cwd が openTab に渡る");
    } finally {
      __testOverrideLLM({ openTab: undefined });
    }
  });
});

test("LLM が openTab で新しいタブを開ける（チャット経由）", async () => {
  await withServer(async ({ base }) => {
    // @why: [2026-09-06] ユーザー要望「LLMが開けるように」。LLM 応答の openTab フィールドで
    //       新しいタブが開かれ、履歴に action として残ることを検証する。
    let openedCwd = null;
    __testOverrideLLM({
      llm: async () => ({
        reply: "新しいタブを開きます",
        actions: [],
        openTab: { cwd: "/tmp/new" },
      }),
      sendAction: async () => ({ ok: true, results: [] }),
      openTab: async (cwd) => {
        openedCwd = cwd;
        return { ok: true, paneId: "777", cwd };
      },
    });
    try {
      await fetch(base + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "新しいタブを開いて" }),
      });
      let entries = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((s) => setTimeout(s, 50));
        entries = (await (await fetch(base + "/api/chat/history")).json()).entries;
        if (entries.some((e) => e.kind === "action" && e.content.includes("新しいタブ"))) break;
      }
      assert.equal(openedCwd, "/tmp/new", "LLM の openTab.cwd が渡る");
      assert.ok(entries.some((e) => e.kind === "action" && e.content.includes("新しいタブを開きました")), "タブを開いた action が履歴に残る");
    } finally {
      __testOverrideLLM({ llm: undefined, sendAction: undefined, openTab: undefined });
    }
  });
});

test("LLM が command でコマンドを実行できる（チャット経由）", async () => {
  await withServer(async ({ base }) => {
    // @why: [2026-09-06] ユーザー要望「コマンドも実行できるといい」。LLM 応答の command フィールドで
    //       シェルコマンドが実行され、出力が履歴に残ることを検証する。
    let ranCmd = null;
    __testOverrideLLM({
      llm: async () => ({ reply: "実行します", actions: [], command: "echo hello" }),
      sendAction: async () => ({ ok: true, results: [] }),
      command: async (cmd) => {
        ranCmd = cmd;
        return { ok: true, stdout: "hello\n", stderr: "" };
      },
    });
    try {
      await fetch(base + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "echo を実行して" }),
      });
      let entries = [];
      for (let i = 0; i < 40; i++) {
        await new Promise((s) => setTimeout(s, 50));
        entries = (await (await fetch(base + "/api/chat/history")).json()).entries;
        if (entries.some((e) => e.kind === "action" && e.content.includes("コマンド実行"))) break;
      }
      assert.equal(ranCmd, "echo hello", "LLM の command が渡る");
      assert.ok(entries.some((e) => e.kind === "action" && e.content.includes("コマンド実行: echo hello")), "コマンド実行 action が履歴に残る");
      assert.ok(entries.some((e) => e.kind === "action" && e.content.includes("hello")), "コマンド出力が履歴に残る");
    } finally {
      __testOverrideLLM({ llm: undefined, sendAction: undefined, command: undefined });
    }
  });
});