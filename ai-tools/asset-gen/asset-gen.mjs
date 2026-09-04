#!/usr/bin/env node
// @why: [2026-08-28] fal.ai API (Recraft v3, Flux) を用いた2Dイラスト・ゲームアセット生成CLI & モジュール。
// @why: [2026-08-29] キャラクター同一性（Identity Consistency）および絵柄保持（Style Consistency）対応。
// @why: ゲームアイテム(SVG)、ドット絵、立ち絵、背景、UI枠を最小の労力で高精度に生成・ローカル保存する。
// @tags: SPEC

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PRESETS, MODEL_ALIASES, EXPRESSIONS, POSES } from './presets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---------- 画像を Data URL / 参照形式に変換 ---------- */
// @why: ローカルファイルパスまたはURLを受け取り、fal.ai が直接解釈できる Data URL または URL を返す。
export function fileToDataUrl(filePathOrUrl) {
  if (!filePathOrUrl) return null;
  if (typeof filePathOrUrl !== 'string') return null;
  if (filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://') || filePathOrUrl.startsWith('data:')) {
    return filePathOrUrl;
  }
  const resolved = resolve(filePathOrUrl);
  if (!existsSync(resolved)) {
    throw new Error(`参照画像が見つかりません: ${filePathOrUrl} (${resolved})`);
  }
  const buf = readFileSync(resolved);
  const ext = extname(resolved).toLowerCase();
  let mime = 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
  else if (ext === '.webp') mime = 'image/webp';
  else if (ext === '.svg') mime = 'image/svg+xml';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/* ---------- .env ロード ---------- */
// @why: CWD, ホームディレクトリ (~/.env), スクリプト配置場所, pi_root から FAL_KEY を自動検出。
export function loadFalKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY;
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(homedir(), '.env'),
    resolve(HERE, '.env'),
    resolve(HERE, '../../.env'),
    resolve(HERE, '../../../.env'),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^FAL_KEY\s*=\s*(.*)$/);
        if (m) {
          const key = m[1].trim().replace(/^["']|["']$/g, '');
          if (key) {
            process.env.FAL_KEY = key;
            return key;
          }
        }
      }
    } catch {
      // ignore read error
    }
  }
  return null;
}

/* ---------- リクエスト構築 ---------- */
// @why: プリセット・モデル・プロンプト・スタイル・サイズ・参照画像を統合したAPIリクエストボディを構築。
export function buildRequestPayload({
  prompt,
  presetName = 'vector-icon',
  modelOverride = null,
  styleOverride = null,
  sizeOverride = null,
  seed = null,
  num = 1,
  charRef = null,
  styleRef = null,
  expression = null,
  pose = null,
  strength = null,
  colors = null,
}) {
  const preset = PRESETS[presetName] || PRESETS['raw'];
  let model = modelOverride || preset.model || 'fal-ai/flux/schnell';
  if (MODEL_ALIASES[model]) model = MODEL_ALIASES[model];

  // プロンプトテンプレート適用（表情・ポーズ引数対応）
  let fullPrompt = prompt;
  if (preset.promptTemplate) {
    if (presetName === 'char-expression') {
      fullPrompt = preset.promptTemplate(prompt, expression || 'happy');
    } else if (presetName === 'char-pose') {
      fullPrompt = preset.promptTemplate(prompt, pose || 'attack');
    } else {
      fullPrompt = preset.promptTemplate(prompt);
    }
  }

  const imageSize = sizeOverride || preset.image_size || 'square_hd';

  // 参照画像の前処理
  const charRefUrl = charRef ? fileToDataUrl(charRef) : null;
  const styleRefUrl = styleRef ? fileToDataUrl(styleRef) : null;

  let body = {};
  if (model.includes('recraft')) {
    const style = styleOverride || preset.style || (model.includes('vector') ? 'vector_illustration' : 'digital_illustration');
    body = {
      prompt: fullPrompt,
      image_size: imageSize,
      style: style,
    };
    if (seed !== null && seed !== undefined) body.seed = Number(seed);

    // 絵柄保持（Style Reference）
    if (styleRefUrl) {
      body.style_references = [{ url: styleRefUrl }];
    }
    // キャラクター同一性・構図参照（Image / Character Reference）
    if (charRefUrl) {
      body.image_references = [{ url: charRefUrl }];
    }
    // パレットカラー固定
    if (colors && Array.isArray(colors) && colors.length > 0) {
      body.colors = colors;
    }
  } else if (model.includes('flux-pro/v1.1-ultra')) {
    let aspect = '1:1';
    if (typeof imageSize === 'string') {
      if (imageSize.includes('16_9') || imageSize.includes('landscape')) aspect = '16:9';
      else if (imageSize.includes('4_3') || imageSize.includes('portrait')) aspect = '3:4';
      else if (imageSize.includes('9_16')) aspect = '9:16';
    }
    body = {
      prompt: fullPrompt,
      aspect_ratio: aspect,
    };
    if (seed !== null && seed !== undefined) body.seed = Number(seed);
  } else if (model.includes('flux-pro')) {
    body = {
      prompt: fullPrompt,
      image_size: imageSize,
      safety_tolerance: '5',
    };
    if (seed !== null && seed !== undefined) body.seed = Number(seed);
  } else if (model.includes('clarity') || model.includes('upscale')) {
    body = {
      image_url: charRefUrl,
      prompt: fullPrompt || 'masterpiece high resolution details',
      upscale_factor: 2,
    };
  } else if (model.includes('flux')) {
    body = {
      prompt: fullPrompt,
      image_size: imageSize,
      num_images: num || 1,
      enable_safety_checker: false,
    };
    if (seed !== null && seed !== undefined) body.seed = Number(seed);

    // Image-to-Image / Reference 対応
    if (charRefUrl) {
      body.image_url = charRefUrl;
      if (strength !== null && strength !== undefined) {
        body.strength = Number(strength);
      }
    }
  } else if (model.includes('ideogram')) {
    body = {
      prompt: fullPrompt,
      aspect_ratio: typeof imageSize === 'string' && imageSize.includes('16_9') ? '16:9' : '1:1',
    };
    if (seed !== null && seed !== undefined) body.seed = Number(seed);
    if (styleRefUrl) {
      body.style_reference_images = [styleRefUrl];
    }
  } else {
    body = {
      prompt: fullPrompt,
      image_size: imageSize,
    };
    if (seed !== null && seed !== undefined) body.seed = Number(seed);
    if (charRefUrl) {
      body.image_url = charRefUrl;
    }
  }

  return {
    model,
    body,
    fullPrompt,
    preset: presetName,
    charRef: charRef ? (charRef.length > 80 ? charRef.slice(0, 80) + '...' : charRef) : null,
    styleRef: styleRef ? (styleRef.length > 80 ? styleRef.slice(0, 80) + '...' : styleRef) : null,
  };
}

/* ---------- アセット生成コア関数 ---------- */
// @why: モジュールインポートからも直接呼べる関数。ファイル保存とサイドカーJSON出力を保証。
export async function generateAsset(options = {}) {
  const {
    prompt,
    preset = 'vector-icon',
    model = null,
    style = null,
    size = null,
    seed = null,
    num = 1,
    charRef = null,
    styleRef = null,
    expression = null,
    pose = null,
    strength = null,
    colors = null,
    out = null,
    dir = './generated-assets',
    dryRun = false,
    fetchFn = fetch,
  } = options;

  if (!prompt) {
    throw new Error('プロンプトが指定されていません。ヒント: 第1引数に生成したいものの説明を渡してください。例: "silver haired knight"');
  }

  const { model: targetModel, body, fullPrompt, preset: usedPreset } = buildRequestPayload({
    prompt,
    presetName: preset,
    modelOverride: model,
    styleOverride: style,
    sizeOverride: size,
    seed,
    num,
    charRef,
    styleRef,
    expression,
    pose,
    strength,
    colors,
  });

  const endpoint = `https://fal.run/${targetModel}`;

  if (dryRun) {
    return {
      dryRun: true,
      endpoint,
      model: targetModel,
      preset: usedPreset,
      fullPrompt,
      charRef: charRef || null,
      styleRef: styleRef || null,
      expression: expression || null,
      pose: pose || null,
      body,
    };
  }

  const key = loadFalKey();
  if (!key) {
    throw new Error('FAL_KEY が見つかりません。ヒント: ~/.env に FAL_KEY=... を設定するか、環境変数 FAL_KEY を export してください。');
  }

  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    let hint = '';
    if (res.status === 401 || res.status === 403) hint = '\nヒント: FAL_KEY が無効か期限切れです。fal.ai ダッシュボードで確認してください。';
    else if (res.status === 404) hint = `\nヒント: モデル '${targetModel}' が見つかりません。--list-presets で利用可能なプリセットを確認してください。`;
    else if (res.status === 429) hint = '\nヒント: レート制限に達しました。しばらく待ってから再試行してください。';
    else if (res.status >= 500) hint = '\nヒント: fal.ai サーバー側の一時的なエラーです。30秒後に再試行してください。';
    throw new Error(`fal.ai API エラー (${res.status} ${res.statusText}): ${errorText}${hint}`);
  }

  const data = await res.json();
  const images = data.images || [];
  if (images.length === 0) {
    throw new Error(`画像が生成されませんでした: ${JSON.stringify(data)}`);
  }

  const results = [];
  const targetDir = out ? dirname(resolve(out)) : resolve(dir);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = prompt.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_').slice(0, 24);

  for (let idx = 0; idx < images.length; idx++) {
    const imgInfo = images[idx];
    const imgUrl = imgInfo.url;
    
    // 拡張子判定
    let ext = '.png';
    if (imgUrl.endsWith('.svg') || imgInfo.content_type?.includes('svg') || body.style === 'vector_illustration') {
      ext = '.svg';
    } else if (imgUrl.endsWith('.webp') || imgInfo.content_type?.includes('webp')) {
      ext = '.webp';
    } else if (imgUrl.endsWith('.jpg') || imgUrl.endsWith('.jpeg')) {
      ext = '.jpg';
    }

    let savePath;
    if (out) {
      savePath = images.length === 1 ? resolve(out) : resolve(out.replace(/(\.[^.]+)$/, `_${idx + 1}$1`));
    } else {
      savePath = join(targetDir, `${slug}_${timestamp}${images.length > 1 ? `_${idx + 1}` : ''}${ext}`);
    }

    // 画像ダウンロード
    const imgRes = await fetchFn(imgUrl);
    if (!imgRes.ok) {
      throw new Error(`画像ダウンロードに失敗しました: ${imgUrl} (${imgRes.status})`);
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    writeFileSync(savePath, buffer);

    // サイドカーメタデータ
    const metaPath = savePath.replace(/\.[^.]+$/, '.json');
    const meta = {
      prompt,
      fullPrompt,
      preset: usedPreset,
      model: targetModel,
      body,
      seed: data.seed || seed || null,
      charRef: charRef || null,
      styleRef: styleRef || null,
      expression: expression || null,
      pose: pose || null,
      fal_url: imgUrl,
      width: imgInfo.width || null,
      height: imgInfo.height || null,
      created_at: new Date().toISOString(),
      file: basename(savePath),
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    results.push({
      filePath: savePath,
      metaPath,
      meta,
      url: imgUrl,
    });
  }

  return {
    success: true,
    model: targetModel,
    preset: usedPreset,
    results,
  };
}

/* ---------- CLI 実行部 ---------- */
function printHelp() {
  console.log(`
asset-gen — fal.ai を用いた2Dイラスト・ゲームアセット生成CLI (v2.0)

▼ クイックスタート
  node asset-gen.mjs "<プロンプト>" [--preset <name>] [--out <path>]
  node asset-gen.mjs --list-presets        ← 全プリセット一覧
  node asset-gen.mjs --list-expressions    ← 全表情キー一覧
  node asset-gen.mjs --list-poses          ← 全ポーズキー一覧

▼ プリセット一覧
${listPresets()}

▼ オプション
  --preset <name>       プリセット選択 (既定: vector-icon)
  --char-ref <file|url> キャラクター同一性参照画像
  --style-ref <file|url> 絵柄・スタイル参照画像
  --expression, -e <str> 表情 (happy, angry, 笑顔, 怒り, ドヤ顔 等)
  --pose, -p <str>       ポーズ (attack, idle, 攻撃, 待機, 詠唱 等)
  --model <name>         モデル上書き (recraft, flux, dev, ideogram 等)
  --style <name>         スタイル指定 (vector_illustration, digital_illustration)
  --size <size>          サイズ指定 (square_hd, portrait_4_3, landscape_16_9)
  --seed <number>        乱数シード値 (再現性の固定)
  --num <number>         生成枚数 (既定: 1)
  --out <path>           保存先ファイル名
  --dir <folder>         保存先ディレクトリ (既定: ./generated-assets)
  --dry-run              API呼び出しを行わずリクエスト内容を確認
  --json                 結果をJSON形式で標準出力
  --list-presets         全プリセット一覧を表示
  --list-expressions     全表情キー一覧を表示
  --list-poses           全ポーズキー一覧を表示
  --help, -h             このヘルプを表示

▼ 使用シーン別クイックリファレンス
  # アイテムアイコン (SVG)
  node asset-gen.mjs "magic blue potion" --preset vector-icon --out ./potion.svg

  # キャラ基準立ち絵
  node asset-gen.mjs "silver haired paladin girl" --preset char-base --out ./hero.png

  # 表情差分（同一性保持）
  node asset-gen.mjs "silver haired paladin girl" --preset char-expression -e 笑顔 --char-ref ./hero.png

  # ポーズ差分（同一性保持）
  node asset-gen.mjs "silver haired paladin girl" --preset char-pose -p 攻撃 --char-ref ./hero.png

  # 攻撃前確認
  node asset-gen.mjs "test prompt" --dry-run
`);
}

function listPresets() {
  return Object.entries(PRESETS).map(([k, v]) => `  ${k.padEnd(18)} ${v.desc}`).join('\n');
}

function listExpressions() {
  const keys = Object.keys(EXPRESSIONS).filter(k => !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(k));
  return keys.join(', ');
}

function listPoses() {
  const keys = Object.keys(POSES).filter(k => !/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(k));
  return keys.join(', ');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  // AI 発見用コマンド（引数不要、即時出力）
  if (args.includes('--list-presets')) {
    console.log(listPresets());
    return;
  }
  if (args.includes('--list-expressions')) {
    console.log(listExpressions());
    return;
  }
  if (args.includes('--list-poses')) {
    console.log(listPoses());
    return;
  }

  let prompt = '';
  let preset = 'vector-icon';
  let model = null;
  let style = null;
  let size = null;
  let seed = null;
  let num = 1;
  let charRef = null;
  let styleRef = null;
  let expression = null;
  let pose = null;
  let strength = null;
  let out = null;
  let dir = './generated-assets';
  let dryRun = false;
  let jsonOutput = false;

  const promptParts = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--preset') preset = args[++i];
    else if (a === '--model') model = args[++i];
    else if (a === '--style') style = args[++i];
    else if (a === '--size') size = args[++i];
    else if (a === '--seed') seed = args[++i];
    else if (a === '--num') num = parseInt(args[++i], 10);
    else if (a === '--char-ref' || a === '--ref') charRef = args[++i];
    else if (a === '--style-ref') styleRef = args[++i];
    else if (a === '--expression' || a === '-e') expression = args[++i];
    else if (a === '--pose' || a === '-p') pose = args[++i];
    else if (a === '--strength') strength = parseFloat(args[++i]);
    else if (a === '--out') out = args[++i];
    else if (a === '--dir') dir = args[++i];
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--json') jsonOutput = true;
    else if (a.startsWith('--')) {
      console.error(`不明なオプション: ${a}`);
      process.exit(1);
    } else {
      promptParts.push(a);
    }
  }

  prompt = promptParts.join(' ').trim();
  if (!prompt) {
    console.error('エラー: プロンプトが指定されていません。');
    printHelp();
    process.exit(1);
  }

  try {
    const result = await generateAsset({
      prompt,
      preset,
      model,
      style,
      size,
      seed,
      num,
      charRef,
      styleRef,
      expression,
      pose,
      strength,
      out,
      dir,
      dryRun,
    });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else if (dryRun) {
      console.log('--- Dry Run モード ---');
      console.log(`Endpoint   : ${result.endpoint}`);
      console.log(`Model      : ${result.model}`);
      console.log(`Preset     : ${result.preset}`);
      if (result.charRef) console.log(`Char Ref   : ${result.charRef}`);
      if (result.styleRef) console.log(`Style Ref  : ${result.styleRef}`);
      if (result.expression) console.log(`Expression : ${result.expression}`);
      if (result.pose) console.log(`Pose       : ${result.pose}`);
      console.log(`Full Prompt: ${result.fullPrompt}`);
      console.log(`Payload    :`);
      console.log(JSON.stringify(result.body, null, 2));
    } else {
      console.log(`✅ 生成完了 [Preset: ${result.preset}, Model: ${result.model}]`);
      for (const item of result.results) {
        console.log(`  📁 保存先   : ${item.filePath}`);
        console.log(`  📄 メタ情報 : ${item.metaPath}`);
        console.log(`  🔗 fal.url  : ${item.url}`);
      }
    }
  } catch (err) {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
