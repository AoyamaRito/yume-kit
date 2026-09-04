#!/usr/bin/env node
/**
 * vision-qa.mjs — 視覚QAサブエージェント（非マルチモーダルの親エージェント用）
 *
 * 画像（スクリーンショット等）をマルチモーダルAIに渡し、
 * 指定タスク（プリセット or 自由プロンプト）に対する日本語レポートを返す。
 *
 * 使い方:
 *   node vision-qa.mjs shot.png --preset terrain
 *   node vision-qa.mjs shot.png "このUIでボタンが重なっていないか3点挙げて"
 *   node vision-qa.mjs a.png b.png --preset ui --out report.md
 *
 * 設定:
 *   .env の OPENROUTER_API_KEY（このフォルダ or ../deepseek-spawn/.env を自動検索）
 *   VISION_MODEL でモデル変更（既定: google/gemini-2.5-flash）
 *
 * 依存: なし（Node 22+ の fetch のみ）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/* ---------- .env ロード（このフォルダ → 親の deepseek-spawn を順に探す） ---------- */
const ENV_CANDIDATES = [
  resolve(HERE, '.env'),
  resolve(HERE, '../deepseek-spawn/.env'),
];
function loadEnv() {
  for (const f of ENV_CANDIDATES) {
    if (!existsSync(f)) continue;
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

/* ---------- プリセット ---------- */
const PRESETS = {
  terrain: {
    desc: '3D地形・チップマップのモニタリング',
    prompt: `あなたは3Dゲームマップの視覚QA担当です。画像をよく観察して、以下を報告してください。
1. 高低差：タイルが1/4単位の段差で積まれているように見えるか。段差は自然か。
2. 破綻：タイル間に透け・穴・隙間・異常な浮きが見えるか（あれば画像中の場所も）。
3. スリット：縦横両方向に細い段差の線が見えるか、特定方向だけに偏っていないか。
4. テクスチャ：草・水・砂・岩・木がRPGドット風に見えるか、色味や違和感。
5. 総合的な印象（3行以内）。
形式: [総評]/[指摘リスト(重要度: 高・中・低 付き)]/[推奨修正]`,
  },
  ui: {
    desc: 'スマホUIの崩れチェック',
    prompt: `あなたはスマホ向けWebアプリUIの視覚QA担当です。画像を観察し以下を報告してください。
1. パネル・ボタン・スライダー・文字が重なったり、画面外にはみ出していないか。
2. タイトルや操作ヒントが読みやすいか（コントラスト、被り）。
3. タップしやすそうなサイズか。
4. レイアウトのバランス（強調すべき箇所と余白）。
5. 総合的な印象（3行以内）。
形式: [総評]/[指摘リスト(重要度: 高・中・低 付き)]/[推奨修正]`,
  },
  aesthetic: {
    desc: '雰囲気・テイストのレビュー',
    prompt: `あなたはアートディレクターです。画像の雰囲気を観察し、以下を報告してください。
1. 全体の世界観とムード（例: ドット絵RPGの島、爽やか、重々しい…）。
2. 配色・ライティング・影の調和。気になる色やトーンがあれば具体的に。
3. 視覚的なノイズや魅力を削ぐ要素。
4. このテイストを一段良くするための具体的な提案（3つ以内）。
5. 総合的な印象（3行以内）。
形式: [総評]/[指摘リスト(重要度: 高・中・低 付き)]/[推奨修正]`,
  },
};

/* ---------- 引数パース ---------- */
const args = process.argv.slice(2);
const images = [];
let prompt = null, outFile = null, presetName = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--preset') presetName = args[++i];
  else if (a === '--out') outFile = args[++i];
  else if (a.startsWith('--')) { console.error('不明なオプション: ' + a); process.exit(2); }
  else if (!a.includes(' ')) images.push(a);
  else prompt = prompt ? prompt + '\n' + a : a;
}
// 残りをプロンプト扱い
prompt = prompt || null;

if (!images.length) {
  console.error(`使い方: node vision-qa.mjs <画像.png> [画像2.png...] [--preset terrain|ui|aesthetic] [--out report.md] ["自由プロンプト"]`);
  console.error(`プリセット: ${Object.keys(PRESETS).join(' / ')} (省略時は自由プロンプト必須)`);
  process.exit(2);
}
for (const f of images) {
  if (!existsSync(resolve(f))) { console.error('画像が見つかりません: ' + f); process.exit(2); }
}

/* ---------- API キー / モデル ---------- */
loadEnv();
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY がありません（vision-qa/.env または ../deepseek-spawn/.env に設定）');
  process.exit(2);
}
const model = process.env.VISION_MODEL || 'google/gemini-2.5-flash';

/* ---------- 画像 → data URL ---------- */
const content = [];
for (const f of images) {
  const buf = readFileSync(resolve(f));
  const ext = f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
  content.push({
    type: 'image_url',
    image_url: { url: `data:image/${ext};base64,${buf.toString('base64')}` },
  });
}
const userText = prompt || PRESETS[presetName].prompt;
content.push({ type: 'text', text: userText + '\n\n（読み取った内容は箇条書きで簡潔に。日本語で。）' });

/* ---------- リクエスト ---------- */
const body = {
  model,
  messages: [
    {
      role: 'system',
      content: 'あなたは視覚QAサブエージェントです。画像を根拠に、決められた形式で簡潔な日本語レポートを返します。画像に見えないことを推測で報告せず、見えるものだけを根拠にしてください。',
    },
    { role: 'user', content },
  ],
  temperature: 0.2,
};

console.error(`[vision-qa] model=${model} images=${images.length} task=${prompt ? '自由' : presetName}`);
const t0 = Date.now();
const res = await fetch(API_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify(body),
});
if (!res.ok) {
  const text = await res.text();
  console.error(`[vision-qa] APIエラー ${res.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}
const data = await res.json();
const report = data.choices?.[0]?.message?.content || '(空の応答)';

/* ---------- 出力 ---------- */
const header = `# 視覚QAレポート\n\n- 対象画像: ${images.join(' / ')}\n- モデル: ${model}\n- タスク: ${presetName ? presetName + ' (' + PRESETS[presetName].desc + ')' : '自由'}\n- 応答時間: ${((Date.now() - t0) / 1000).toFixed(1)}s\n\n`;
const md = header + report.trim() + '\n';
if (outFile) {
  writeFileSync(resolve(outFile), md);
  console.error(`[vision-qa] レポート保存: ${outFile}`);
} else {
  console.log(md);
}
// 機械可読用にJSONも残す（--out 指定時のみ）
if (outFile) {
  writeFileSync(resolve(outFile).replace(/\.md$/, '') + '.json', JSON.stringify({
    images, model, task: presetName || 'free', prompt: userText, report, ms: Date.now() - t0,
  }, null, 2));
}