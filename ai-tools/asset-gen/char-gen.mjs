#!/usr/bin/env node
// @why: [2026-08-29] キャラクター同一性（Identity Consistency）と絵柄保持（Style Consistency）に特化した制作スタジオエンジン。
// @why: キャラクター定義（JSON）からベース立ち絵・表情差分・ポーズ差分・ドット絵・ちびキャラを一括生成し、
// @why: インタラクティブなHTMLプレビューア（立ち絵切り替え・背景チェッカー）を自動出力する。
// @tags: SPEC

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, EXPRESSIONS, POSES } from './presets.mjs';
import { generateAsset, loadFalKey, fileToDataUrl } from './asset-gen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---------- デフォルト表情・ポーズパック一覧 ---------- */
export const DEFAULT_EXPRESSION_PACK = [
  'neutral',
  'happy',
  'serious',
  'angry',
  'surprised',
  'blushing',
  'smug',
  'wink',
];

export const DEFAULT_POSE_PACK = [
  'idle',
  'attack',
  'defense',
  'casting',
  'victory',
  'hurt',
];

/* ---------- キャラクター初期設定テンプレート生成 ---------- */
export function createCharacterTemplate(name, traits = '') {
  return {
    name: name || 'hero',
    displayName: name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Hero',
    traits: traits || 'young paladin with silver hair and emerald eyes, wearing silver armor with royal blue cape',
    preset: 'char-base',
    model: 'fal-ai/recraft-v3',
    style: 'digital_illustration',
    seed: Math.floor(Math.random() * 1000000),
    baseImage: null,
    styleReference: null,
    colors: [],
    created_at: new Date().toISOString(),
  };
}

/* ---------- インタラクティブ HTML ビューア出力 ---------- */
// @why: 生成したキャラクターの立ち絵・表情・ポーズ・ドット絵を即座に視覚確認・切り替えできるプレビューHTMLを生成。
export function generateViewerHtml({ character, assets, outDir }) {
  const assetsJson = JSON.stringify(assets, null, 2);
  const charJson = JSON.stringify(character, null, 2);

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${character.displayName || character.name} — Character Asset Studio</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --accent: #58a6ff;
      --text: #c9d1d9;
      --text-bright: #f0f6fc;
      --text-dim: #8b949e;
      --success: #3fb950;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 24px;
      color: var(--text-bright);
    }
    .header .subtitle {
      font-size: 14px;
      color: var(--text-dim);
    }
    .layout {
      display: grid;
      grid-template-columns: 380px 1fr;
      gap: 24px;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
    }
    /* プレビュー側 */
    .preview-pane {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .stage-container {
      width: 100%;
      height: 440px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
      margin-bottom: 16px;
      transition: background 0.2s;
    }
    .bg-checker {
      background-color: #22272e;
      background-image: 
        linear-gradient(45deg, #1c2128 25%, transparent 25%), 
        linear-gradient(-45deg, #1c2128 25%, transparent 25%), 
        linear-gradient(45deg, transparent 75%, #1c2128 75%), 
        linear-gradient(-45deg, transparent 75%, #1c2128 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
    }
    .bg-dark { background: #000; }
    .bg-white { background: #fff; }
    .bg-dungeon {
      background: linear-gradient(180deg, #101426 0%, #2a1625 100%);
    }
    .stage-image {
      max-width: 95%;
      max-height: 95%;
      object-fit: contain;
      filter: drop-shadow(0 10px 20px rgba(0,0,0,0.5));
      transition: transform 0.15s ease;
    }
    .bg-buttons {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .bg-btn {
      padding: 4px 10px;
      font-size: 12px;
      background: #21262d;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
    }
    .bg-btn.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .char-info {
      width: 100%;
      font-size: 13px;
      background: #0d1117;
      border: 1px solid var(--border);
      padding: 12px;
      border-radius: 6px;
      color: var(--text-dim);
    }
    .char-info strong { color: var(--text-bright); }

    /* アセット一覧側 */
    .assets-pane {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-bright);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-badge {
      font-size: 11px;
      background: #238636;
      color: #fff;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .asset-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 12px;
    }
    .asset-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .asset-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    .asset-card.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.4);
    }
    .thumb-wrap {
      width: 100%;
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0d1117;
      border-radius: 4px;
      margin-bottom: 8px;
      overflow: hidden;
    }
    .thumb-wrap img {
      max-width: 90%;
      max-height: 90%;
      object-fit: contain;
    }
    .asset-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-bright);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }
    .asset-type {
      font-size: 10px;
      color: var(--text-dim);
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1>🎭 ${character.displayName || character.name} — Asset Studio</h1>
      <div class="subtitle">${character.traits}</div>
    </div>
    <div style="font-size: 12px; color: var(--text-dim);">
      Total: <span id="total-count">${assets.length}</span> Assets
    </div>
  </div>

  <div class="layout">
    <!-- プレビュー部 -->
    <div class="preview-pane">
      <div class="bg-buttons">
        <button class="bg-btn active" onclick="setBg('bg-checker', this)">透過チェッカー</button>
        <button class="bg-btn" onclick="setBg('bg-dark', this)">Dark</button>
        <button class="bg-btn" onclick="setBg('bg-white', this)">White</button>
        <button class="bg-btn" onclick="setBg('bg-dungeon', this)">Dungeon</button>
      </div>

      <div class="stage-container bg-checker" id="stage">
        <img class="stage-image" id="stage-img" src="${assets[0]?.relPath || ''}" alt="preview">
      </div>

      <div class="char-info" id="asset-info">
        <div><strong>名前:</strong> <span id="info-label">${assets[0]?.label || '-'}</span></div>
        <div><strong>分類:</strong> <span id="info-category">${assets[0]?.category || '-'}</span></div>
        <div><strong>ファイル:</strong> <span id="info-file">${assets[0]?.relPath || '-'}</span></div>
      </div>
    </div>

    <!-- アセット一覧部 -->
    <div class="assets-pane" id="assets-container">
      <!-- JavaScript で動的展開 -->
    </div>
  </div>

  <script>
    const ASSETS = ${assetsJson};
    const CHAR = ${charJson};

    function setBg(bgClass, btn) {
      const stage = document.getElementById('stage');
      stage.className = 'stage-container ' + bgClass;
      document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }

    function selectAsset(idx) {
      const item = ASSETS[idx];
      if (!item) return;
      document.getElementById('stage-img').src = item.relPath;
      document.getElementById('info-label').innerText = item.label;
      document.getElementById('info-category').innerText = item.category;
      document.getElementById('info-file').innerText = item.relPath;

      document.querySelectorAll('.asset-card').forEach((card, i) => {
        if (i === idx) card.classList.add('selected');
        else card.classList.remove('selected');
      });
    }

    function renderGrids() {
      const container = document.getElementById('assets-container');
      const categories = ['base', 'expressions', 'poses', 'pixel', 'chibi', 'others'];
      const grouped = {};
      
      ASSETS.forEach((a, idx) => {
        const cat = a.category || 'others';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ ...a, idx });
      });

      const catTitles = {
        'base': '⭐ 基準立ち絵 (Base Reference)',
        'expressions': '😊 表情差分 (Expression Pack)',
        'poses': '⚔️ ポーズ・アクション差分 (Pose Pack)',
        'pixel': '👾 レトロドット絵 (Pixel Art)',
        'chibi': '✨ SD・ちびキャラ (Chibi)',
        'others': '📁 その他アセット',
      };

      for (const cat of categories) {
        if (!grouped[cat] || grouped[cat].length === 0) continue;
        const list = grouped[cat];

        const section = document.createElement('div');
        section.innerHTML = \`
          <div class="section-title">
            \${catTitles[cat] || cat}
            <span class="section-badge">\${list.length}</span>
          </div>
          <div class="asset-grid" id="grid-\${cat}"></div>
        \`;
        container.appendChild(section);

        const grid = section.querySelector(\`#grid-\${cat}\`);
        list.forEach(item => {
          const card = document.createElement('div');
          card.className = 'asset-card' + (item.idx === 0 ? ' selected' : '');
          card.onclick = () => selectAsset(item.idx);
          card.innerHTML = \`
            <div class="thumb-wrap">
              <img src="\${item.relPath}" alt="\${item.label}" loading="lazy">
            </div>
            <div class="asset-label">\${item.label}</div>
            <div class="asset-type">\${item.category}</div>
          \`;
          grid.appendChild(card);
        });
      }
    }

    renderGrids();
  </script>
</body>
</html>`;

  const viewerPath = join(outDir, 'viewer.html');
  writeFileSync(viewerPath, html, 'utf8');
  return viewerPath;
}

/* ---------- キャラクター一式生成パイプライン ---------- */
// @why: キャラクター定義を受け取り、ベース生成→同一性参照付き表情・ポーズ・ドット絵パック生成→ビューア出力。
export async function generateCharacterPack(options = {}) {
  const {
    charConfig,
    outDir = './generated-characters',
    packs = ['base', 'expressions', 'poses', 'pixel', 'chibi'],
    expressions = DEFAULT_EXPRESSION_PACK,
    poses = DEFAULT_POSE_PACK,
    seed = null,
    dryRun = false,
    fetchFn = fetch,
  } = options;

  let char = typeof charConfig === 'string' ? JSON.parse(readFileSync(resolve(charConfig), 'utf8')) : { ...charConfig };
  const targetDir = resolve(outDir, char.name || 'hero');
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const generatedAssets = [];
  const finalSeed = seed !== null && seed !== undefined ? seed : (char.seed || Math.floor(Math.random() * 1000000));

  // 1. Base 生成（立ち絵基準画像）
  let baseImagePath = char.baseImage ? resolve(char.baseImage) : null;
  if (!baseImagePath || !existsSync(baseImagePath)) {
    const baseOut = join(targetDir, `${char.name}_base.png`);
    const res = await generateAsset({
      prompt: char.traits,
      preset: 'char-base',
      model: char.model || 'fal-ai/recraft-v3',
      style: char.style || 'digital_illustration',
      seed: finalSeed,
      out: baseOut,
      dryRun,
      fetchFn,
    });
    baseImagePath = baseOut;
    char.baseImage = baseOut;

    generatedAssets.push({
      label: 'Base (基準)',
      category: 'base',
      filePath: baseOut,
      relPath: basename(baseOut),
      dryRunInfo: res,
    });
  } else {
    generatedAssets.push({
      label: 'Base (既存基準)',
      category: 'base',
      filePath: baseImagePath,
      relPath: basename(baseImagePath),
    });
  }

  // 2. 表情パック生成（Expression Pack）
  if (packs.includes('expressions') || packs.includes('all')) {
    for (const exp of expressions) {
      const expOut = join(targetDir, `${char.name}_exp_${exp}.png`);
      const res = await generateAsset({
        prompt: char.traits,
        preset: 'char-expression',
        model: char.model || 'fal-ai/recraft-v3',
        style: char.style || 'digital_illustration',
        expression: exp,
        charRef: baseImagePath,
        styleRef: char.styleReference || baseImagePath,
        seed: finalSeed,
        out: expOut,
        dryRun,
        fetchFn,
      });

      generatedAssets.push({
        label: `表情: ${exp}`,
        category: 'expressions',
        filePath: expOut,
        relPath: basename(expOut),
        dryRunInfo: res,
      });
    }
  }

  // 3. ポーズパック生成（Pose Pack）
  if (packs.includes('poses') || packs.includes('all')) {
    for (const pose of poses) {
      const poseOut = join(targetDir, `${char.name}_pose_${pose}.png`);
      const res = await generateAsset({
        prompt: char.traits,
        preset: 'char-pose',
        model: char.model || 'fal-ai/recraft-v3',
        style: char.style || 'digital_illustration',
        pose: pose,
        charRef: baseImagePath,
        styleRef: char.styleReference || baseImagePath,
        seed: finalSeed,
        out: poseOut,
        dryRun,
        fetchFn,
      });

      generatedAssets.push({
        label: `ポーズ: ${pose}`,
        category: 'poses',
        filePath: poseOut,
        relPath: basename(poseOut),
        dryRunInfo: res,
      });
    }
  }

  // 4. ドット絵スプライト生成 (Pixel Art)
  if (packs.includes('pixel') || packs.includes('all')) {
    const pixelOut = join(targetDir, `${char.name}_pixel.png`);
    const res = await generateAsset({
      prompt: char.traits,
      preset: 'char-pixel',
      charRef: baseImagePath,
      seed: finalSeed,
      out: pixelOut,
      dryRun,
      fetchFn,
    });

    generatedAssets.push({
      label: '16-bit ドット絵',
      category: 'pixel',
      filePath: pixelOut,
      relPath: basename(pixelOut),
      dryRunInfo: res,
    });
  }

  // 5. ちびキャラ生成 (Chibi)
  if (packs.includes('chibi') || packs.includes('all')) {
    const chibiOut = join(targetDir, `${char.name}_chibi.png`);
    const res = await generateAsset({
      prompt: char.traits,
      preset: 'char-chibi',
      charRef: baseImagePath,
      styleRef: char.styleReference || baseImagePath,
      seed: finalSeed,
      out: chibiOut,
      dryRun,
      fetchFn,
    });

    generatedAssets.push({
      label: 'SDちびキャラ',
      category: 'chibi',
      filePath: chibiOut,
      relPath: basename(chibiOut),
      dryRunInfo: res,
    });
  }

  // 6. 設定ファイル保存 (character.json)
  const charConfigPath = join(targetDir, 'character.json');
  writeFileSync(charConfigPath, JSON.stringify(char, null, 2), 'utf8');

  // 7. インタラクティブ HTML ビューア出力
  const viewerPath = generateViewerHtml({
    character: char,
    assets: generatedAssets,
    outDir: targetDir,
  });

  return {
    success: true,
    character: char,
    targetDir,
    configPath: charConfigPath,
    viewerPath,
    assets: generatedAssets,
  };
}

/* ---------- CLI 実行部 ---------- */
function printHelp() {
  console.log(`
char-gen — キャラクター同一性・絵柄保持 アセット制作スタジオ

使い方:
  node char-gen.mjs init <名前> "<特徴プロンプト>"   : 設定テンプレート (character.json) 作成
  node char-gen.mjs create <名前> "<特徴プロンプト>" : キャラクター立ち絵＋設定を作成
  node char-gen.mjs pack <設定ファイル> [オプション] : 表情・ポーズ・ドット絵を一括生成
  node char-gen.mjs preview <キャラフォルダ>         : HTMLプレビューアを再生成

パック生成オプション:
  --pack <list>        生成パック (all, expressions, poses, pixel, chibi / カンマ区切り)
  --expressions <list> 表情リスト (既定: neutral,happy,serious,angry,surprised,blushing,smug,wink)
  --poses <list>       ポーズリスト (既定: idle,attack,defense,casting,victory,hurt)
  --seed <number>      乱数シード値 (完全再現)
  --dir <folder>       出力ルートディレクトリ (既定: ./generated-characters)
  --dry-run            API呼び出しを行わずリクエスト構造を確認
  --help, -h           このヘルプを表示

例:
  # 1. 聖騎士エレーナの設定＆ベース画像を作成
  node char-gen.mjs create elena "young female paladin with silver twintail hair, emerald green eyes, ornate silver plate armor, royal blue cape"

  # 2. 表情差分＋ポーズ＋ドット絵＋ちびキャラを一括生成（同一性を保持）
  node char-gen.mjs pack ./generated-characters/elena/character.json --pack all

  # 3. ブラウザで viewer.html を開いてインタラクティブに確認
  open ./generated-characters/elena/viewer.html
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (command === 'init') {
    const name = args[1] || 'hero';
    const traits = args[2] || '';
    const tmpl = createCharacterTemplate(name, traits);
    const outFile = `./${name}.json`;
    writeFileSync(resolve(outFile), JSON.stringify(tmpl, null, 2), 'utf8');
    console.log(`✅ キャラクター設定テンプレートを作成しました: ${outFile}`);
    return;
  }

  if (command === 'create') {
    const name = args[1];
    const traits = args[2];
    if (!name || !traits) {
      console.error('エラー: 名前と特徴プロンプトを指定してください。例: node char-gen.mjs create elena "silver hair paladin"');
      process.exit(1);
    }
    const tmpl = createCharacterTemplate(name, traits);
    const result = await generateCharacterPack({
      charConfig: tmpl,
      packs: ['base'],
    });
    console.log(`✅ キャラクターを作成しました:`);
    console.log(`  📁 ディレクトリ : ${result.targetDir}`);
    console.log(`  📄 設定ファイル : ${result.configPath}`);
    console.log(`  🎭 ビューア     : ${result.viewerPath}`);
    return;
  }

  if (command === 'pack') {
    const configPath = args[1];
    if (!configPath || !existsSync(resolve(configPath))) {
      console.error('エラー: 有効な character.json のパスを指定してください。');
      process.exit(1);
    }

    let packArg = 'all';
    let dir = './generated-characters';
    let seed = null;
    let dryRun = false;
    let expList = DEFAULT_EXPRESSION_PACK;
    let poseList = DEFAULT_POSE_PACK;

    for (let i = 2; i < args.length; i++) {
      const a = args[i];
      if (a === '--pack') packArg = args[++i];
      else if (a === '--dir') dir = args[++i];
      else if (a === '--seed') seed = parseInt(args[++i], 10);
      else if (a === '--dry-run') dryRun = true;
      else if (a === '--expressions') expList = args[++i].split(',').map(s => s.trim());
      else if (a === '--poses') poseList = args[++i].split(',').map(s => s.trim());
    }

    const packs = packArg === 'all' ? ['expressions', 'poses', 'pixel', 'chibi'] : packArg.split(',').map(s => s.trim());

    const result = await generateCharacterPack({
      charConfig: configPath,
      outDir: dir,
      packs,
      expressions: expList,
      poses: poseList,
      seed,
      dryRun,
    });

    console.log(`✅ キャラクターパック生成完了:`);
    console.log(`  📁 出力先   : ${result.targetDir}`);
    console.log(`  🎭 ビューア : ${result.viewerPath}`);
    console.log(`  📦 生成数   : ${result.assets.length} 件`);
    return;
  }

  if (command === 'preview') {
    const folder = args[1] || './generated-characters/hero';
    const targetDir = resolve(folder);
    const jsonPath = join(targetDir, 'character.json');
    if (!existsSync(jsonPath)) {
      console.error(`エラー: ${jsonPath} が見つかりません。`);
      process.exit(1);
    }
    const char = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const files = readdirSync(targetDir).filter(f => /\.(png|jpg|webp|svg)$/i.test(f));
    const assets = files.map(f => {
      let category = 'others';
      if (f.includes('base')) category = 'base';
      else if (f.includes('exp_')) category = 'expressions';
      else if (f.includes('pose_')) category = 'poses';
      else if (f.includes('pixel')) category = 'pixel';
      else if (f.includes('chibi')) category = 'chibi';
      return {
        label: f.replace(/\.[^.]+$/, '').replace(new RegExp(`^${char.name}_`), ''),
        category,
        filePath: join(targetDir, f),
        relPath: f,
      };
    });

    const viewerPath = generateViewerHtml({
      character: char,
      assets,
      outDir: targetDir,
    });
    console.log(`✅ ビューアを再生成しました: ${viewerPath}`);
    return;
  }

  console.error(`不明なコマンド: ${command}`);
  printHelp();
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}
