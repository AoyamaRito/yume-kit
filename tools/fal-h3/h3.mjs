#!/usr/bin/env node
// MiniMax H3 (fal.ai) フレーム指定ツール
// @why: ユーザー要望「fal.ai の key を確認できたら、その仕様で mini-max h3 をフレーム指定するツールを制作」
//       fal.ai 公式スキーマ（/tmp/h3_schemas_full.json 経由で取得）を基に、
//       指定可能要素（image/end_image/duration/resolution/seed/prompt_expansion 等）を
//       CLI から使いやすく指定できるようにした。ローカル画像は rest.fal.ai/storage/upload/initiate → PUT で自動アップロード。
// @tags: SPEC

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 設定 ----------
const REST_API = 'https://rest.fal.ai';
const QUEUE_API = 'https://queue.fal.run';
const ENDPOINTS = {
  i2v: '/minimax/h3/image-to-video',        // フレーム指定（image / end_image）
  ref: '/minimax/h3/reference-to-video',    // 参照指定（reference images/videos/audio）
  t2v: '/minimax/h3-max/text-to-video',     // H3 Max テキスト→動画
  i2vMax: '/minimax/h3-max/image-to-video', // H3 Max 画像→動画
};

// ---------- ユーティリティ ----------
function log(...args) { console.error(...args); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// .env から FAL_KEY を読む（環境変数が最優先）
// @why: 明示的に --env が指定された場合はそのファイルのみを読み、pi_root/.env 等へのフォールバックをしない。
//       ユーザーが別キーを指定する意図を尊重し、E2E で「キー無しエラー」をテスト可能にする。
function loadFalKey(envPath) {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const candidates = envPath
    ? [envPath]
    : [
        path.join(__dirname, '.env'),
        path.join(__dirname, '..', '..', '.env'),   // pi_root/.env
        path.join(process.cwd(), '.env'),
      ];
  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^FAL_KEY\s*=\s*(.+)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* ignore */ }
  }
  return undefined;
}

// 画像ファイルを fal CDN にアップロードして公開 URL を返す
async function uploadImage(filePath, key) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                 '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' }[ext] || 'application/octet-stream';
  const fileName = path.basename(filePath);
  // 1) initiate
  const initRes = await fetch(`${REST_API}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: mime, file_name: fileName }),
  });
  if (!initRes.ok) throw new Error(`upload initiate failed: ${initRes.status} ${await initRes.text()}`);
  const { upload_url: uploadUrl, file_url: fileUrl } = await initRes.json();
  // 2) PUT 本体
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: buf,
  });
  if (!putRes.ok) throw new Error(`upload PUT failed: ${putRes.status} ${await putRes.text()}`);
  return fileUrl;
}

// 値が URL ならそのまま、ローカルファイルならアップロード
async function resolveImage(value, key) {
  if (!value) return undefined;
  if (/^https?:\/\//.test(value)) return value;
  if (fs.existsSync(value)) return await uploadImage(value, key);
  throw new Error(`画像が見つかりません: ${value}（URL か既存ファイルパスを指定してください）`);
}

// ---------- 引数パース（依存ゼロ） ----------
function parseArgs(argv) {
  const opts = { endpoint: 'i2v', duration: 5, resolution: '2K', promptExpansion: 'balanced' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--prompt': case '-p': opts.prompt = next(); break;
      case '--image': case '-i': opts.image = next(); break;              // 開始フレーム
      case '--end-image': case '-e': opts.endImage = next(); break;       // 終了フレーム（フレーム指定の肝）
      case '--duration': case '-d': opts.duration = parseInt(next(), 10); break;
      case '--resolution': case '-r': opts.resolution = next(); break;    // 480P/768P/2K/4K
      case '--seed': opts.seed = parseInt(next(), 10); break;
      case '--prompt-expansion': opts.promptExpansion = next(); break;    // fast/balanced/quality
      case '--no-expansion': opts.promptExpansion = undefined; break;     // 展開オフ
      case '--no-safety': opts.noSafety = true; break;
      case '--sync': opts.syncMode = true; break;                         // base64 返却
      case '--mode': case '-m': opts.endpoint = next(); break;            // i2v / ref / t2v / i2vMax
      case '--ref-image': opts.refImages = (opts.refImages || []).concat(next().split(',')); break;
      case '--ref-video': opts.refVideos = (opts.refVideos || []).concat(next().split(',')); break;
      case '--ref-audio': opts.refAudios = (opts.refAudios || []).concat(next().split(',')); break;
      case '--aspect': opts.aspectRatio = next(); break;                  // adaptive/21:9/16:9/4:3/1:1/3:4/9:16
      case '--out': opts.out = next(); break;                             // 保存先
      case '--env': opts.envPath = next(); break;
      case '--timeout': opts.timeout = parseInt(next(), 10) * 1000; break;
      case '--poll-interval': opts.pollInterval = parseInt(next(), 10) * 1000; break;
      case '--json': opts.json = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`不明な引数: ${a}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`MiniMax H3 (fal.ai) フレーム指定ツール
使い方:
  node h3.mjs --prompt "説明文" [オプション]

必須:
  --prompt, -p <文>             動画内容のプロンプト

フレーム指定（i2v モード・このツールの核）:
  --image, -i <URL|ファイル>    開始フレーム（省略時は t2v 扱い 16:9）
  --end-image, -e <URL|ファイル> 終了フレーム（開始→終了の遷移を指定。フレーム指定！）

動画設定:
  --duration, -d <5..15>        秒数（既定 5）
  --resolution, -r <480P|768P|2K|4K>  解像度（既定 2K）
  --seed <数値>                 乱数シード（再現用）
  --prompt-expansion <fast|balanced|quality>  プロンプト展開量（既定 balanced）
  --no-expansion                プロンプト展開を無効化
  --no-safety                   安全チェッカー無効
  --sync                        結果を base64 で返す（CDN でなく）

参照モード（--mode ref）:
  --ref-image <URL,...>         参照画像（最大9・プロンプト中 "Image 1" 等で参照）
  --ref-video <URL,...>         参照動画（最大3）
  --ref-audio <URL,...>         参照音声（最大3・画像/動画と併用必須）
  --aspect <adaptive|21:9|16:9|4:3|1:1|3:4|9:16>  アスペクト比

モード切替:
  --mode, -m <i2v|ref|t2v|i2vMax>  既定 i2v

出力:
  --out <ファイル>              生成動画の保存先（例: out.mp4）
  --json                        結果を JSON で出力（stdout）
  --env <パス>                  .env ファイルの場所（既定は pi_root/.env を自動探索）

例:
  node h3.mjs -p "桜が舞い散る" -i start.png -e end.png -d 10 -r 480P --out sakura.mp4
  node h3.mjs -m ref -p "Image 1 のキャラが歩く" --ref-image char.png --aspect 9:16 -d 8`);
}

// ---------- リクエスト構築 ----------
function buildInput(opts) {
  const input = { prompt: opts.prompt, duration: opts.duration, resolution: opts.resolution };
  if (opts.endpoint === 'i2v') {
    if (opts.image) input.image_url = opts.image;
    if (opts.endImage) input.end_image_url = opts.endImage;
  }
  if (opts.endpoint === 'ref') {
    if (opts.refImages) input.reference_image_urls = opts.refImages;
    if (opts.refVideos) input.reference_video_urls = opts.refVideos;
    if (opts.refAudios) input.reference_audio_urls = opts.refAudios;
    if (opts.aspectRatio) input.aspect_ratio = opts.aspectRatio;
  }
  if (opts.seed !== undefined) input.seed = opts.seed;
  if (opts.promptExpansion !== undefined) input.prompt_expansion_mode = opts.promptExpansion;
  if (opts.noSafety) input.enable_safety_checker = false;
  if (opts.syncMode) input.sync_mode = true;
  return input;
}

// ---------- ジョブ送信 → ポーリング → 完了 ----------
async function submitJob(endpoint, input, key) {
  const res = await fetch(`${QUEUE_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.text();
  if (!res.ok) {
    // 422 ならバリデーション詳細を表示
    try {
      const j = JSON.parse(body);
      throw new Error(`送信失敗 ${res.status}: ${JSON.stringify(j.detail || j)}`);
    } catch (e) {
      if (e.message.startsWith('送信失敗')) throw e;
      throw new Error(`送信失敗 ${res.status}: ${body.slice(0, 500)}`);
    }
  }
  return JSON.parse(body);
}

// @why: fal.ai の status エンドポイントは COMPLETED 状態のみを返し、結果データ（動画URL等）は含まない。
//       SDK 実装（queue.js）に倣い、完了後に response_url（status_url から /status を除いた URL）を
//       GET して結果を取得する。
async function pollJob(statusUrl, key, { timeout = 600000, interval = 3000 } = {}) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    const res = await fetch(statusUrl, { headers: { 'Authorization': `Key ${key}` } });
    const j = await res.json();
    const status = j.status;
    if (status === 'COMPLETED') {
      // 結果は response_url から取得
      const responseUrl = j.response_url;
      const res2 = await fetch(responseUrl, { headers: { 'Authorization': `Key ${key}` } });
      if (!res2.ok) throw new Error(`結果取得失敗: ${res2.status} ${await res2.text()}`);
      return await res2.json();
    }
    if (status === 'FAILED' || status === 'CANCELLED') {
      throw new Error(`ジョブ ${status}: ${JSON.stringify(j.error || j).slice(0, 500)}`);
    }
    const msg = status + (j.queue_position !== undefined ? ` (待ち ${j.queue_position})` : '');
    if (msg !== last) { log(`  [${new Date().toLocaleTimeString()}] ${msg}`); last = msg; }
    await sleep(interval);
  }
  throw new Error(`タイムアウト（${timeout / 1000}秒）: ${statusUrl}`);
}

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

// ---------- メイン ----------
async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { log('エラー:', e.message); printHelp(); process.exit(1); }
  if (opts.help) { printHelp(); return; }

  const key = loadFalKey(opts.envPath);
  if (!key) { log('エラー: FAL_KEY が見つかりません（.env を確認）'); process.exit(1); }

  if (!opts.prompt) { log('エラー: --prompt は必須です'); printHelp(); process.exit(1); }

  const endpoint = ENDPOINTS[opts.endpoint];
  if (!endpoint) { log(`エラー: 不明なモード ${opts.endpoint}（i2v/ref/t2v/i2vMax）`); process.exit(1); }

  // ローカル画像をアップロード（URL はそのまま）
  log(`▶ ${endpoint}`);
  try {
    if (opts.image) { opts.image = await resolveImage(opts.image, key); log(`  開始フレーム: ${opts.image}`); }
    if (opts.endImage) { opts.endImage = await resolveImage(opts.endImage, key); log(`  終了フレーム: ${opts.endImage}`); }
    if (opts.refImages) { opts.refImages = await Promise.all(opts.refImages.map(v => resolveImage(v, key))); log(`  参照画像: ${opts.refImages.join(', ')}`); }
    if (opts.refVideos) { opts.refVideos = await Promise.all(opts.refVideos.map(v => resolveImage(v, key))); log(`  参照動画: ${opts.refVideos.join(', ')}`); }
    if (opts.refAudios) { opts.refAudios = await Promise.all(opts.refAudios.map(v => resolveImage(v, key))); log(`  参照音声: ${opts.refAudios.join(', ')}`); }
  } catch (e) { log('エラー:', e.message); process.exit(1); }

  const input = buildInput(opts);
  log(`  プロンプト: ${opts.prompt.slice(0, 80)}${opts.prompt.length > 80 ? '…' : ''}`);
  log(`  設定: duration=${input.duration}s resolution=${input.resolution} seed=${input.seed ?? 'random'} prompt_expansion=${input.prompt_expansion_mode ?? 'off'}`);

  log('▶ ジョブ送信中…');
  const job = await submitJob(endpoint, input, key);
  const statusUrl = job.status_url || job.response_url;
  log(`  request_id: ${job.request_id}`);
  log(`  status: ${statusUrl}`);

  log('▶ 生成待機（ポーリング）…');
  const result = await pollJob(statusUrl, key, { timeout: opts.timeout, interval: opts.pollInterval });

  // 結果（video.url / base64）
  const video = result.video || {};
  const videoUrl = video.url || video;
  const expanded = result.expanded_prompt;

  const out = {
    request_id: job.request_id,
    video_url: typeof videoUrl === 'string' ? videoUrl : undefined,
    expanded_prompt: expanded ?? undefined,
  };

  if (opts.out) {
    if (typeof videoUrl !== 'string') throw new Error('ダウンロード可能な video.url がありません');
    const bytes = await download(videoUrl, opts.out);
    log(`▶ 保存: ${opts.out} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
    out.saved_to = path.resolve(opts.out);
  }

  if (expanded) log(`  展開後プロンプト: ${expanded.slice(0, 120)}…`);

  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`\n完了 ✓`);
    console.log(`  動画: ${out.video_url}`);
  }
}

main().catch(e => { log('エラー:', e.message); process.exit(1); });
