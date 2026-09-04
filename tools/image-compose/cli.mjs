// ─────────────────────────────────────────────────────────────────
// map of meaning — cli.mjs
// 責務: コマンドライン → シーン読込 → src の絶対URL化 → core で HTML → Chrome headless で PNG 焼き。
//   node cli.mjs scene.json -o out.png [--html out.html] [--check]
// 壊してはいけない性質:
//   - ローカル画像は --allow-file-access-from-files で Chrome に読ませる（無いと白飛び=調査で実証）。
//   - 透明PNG は --default-background-color=00000000（canvas.bg が transparent のとき）。
//   - --check は src 実在まで確認し、異常があれば exit code 2（CI・AIループ向け）。
// ─────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildScene, checkScene, renderHTML, isTransparentBg } from './core.mjs';

const HELP = `image-compose-cli — レイヤー合成を一枚のPNGへ焼く
使い方:
  node cli.mjs <scene.json> -o out.png [--html out.html] [--check] [--skip-html]

オプション:
  -o out.png   出力 PNG（必須）
  --html f.html   目視/検証用 HTML を指定パスにも書く（既定: 出力PNGと同じ名前で .html）
  --check      検証のみ（PNGを焼かず）: src 実在・構造破綻を報告。異常時は終了コード2
  --skip-html  HTML を書き出さない
  -h, --help   このヘルプ

シーンJSONスキーマ:
  { "canvas": { "w": 1280, "h": 720, "bg": "#223" | "transparent" },
    "layers": [ { "type": "img"|"rect"|"gradient"|"text", ... } ] }
  レイヤー共通: x y w h z rotate opacity blur blend(blendモード) shadow filter corner flip(h|v)
  img: src fit(cover|contain|fill|none) position / rect: bg border / gradient: from to angle / text: dir(h|v) text font size color ...
詳細は DESIGN.md
`;

function usage() {
  process.stderr.write(HELP);
  process.exit(1);
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'chromium', 'google-chrome', 'chrome',
];

// @why: [2026-08-31] layout-cli と同じ探索（絶対パス優先→PATH）。見つからなければ null。
// @why: [2026-08-31] PATH からコマンド探索（findChrome の既存ヘルパーと自分使い）。magick はクロップに使う。
function findInPath(cmd) {
  try { return execFileSync('which', [cmd], { encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
      continue;
    }
    try {
      const r = execFileSync('which', [c], { encoding: 'utf8' }).trim();
      if (r) return r;
    } catch { /* 次の候補へ */ }
  }
  return null;
}

function parseArgs(argv) {
  const a = { scene: null, out: null, html: null, check: false, skipHtml: false };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--check') a.check = true;
    else if (tok === '--skip-html') a.skipHtml = true;
    else if (tok === '--html') a.html = argv[++i];
    else if (tok === '-o') a.out = argv[++i];
    else if (tok === '-h' || tok === '--help') usage();
    else if (tok.startsWith('-')) usage();
    else if (!a.scene) a.scene = tok;
    else usage();
  }
  return a;
}

/** data:/http(s)/file: はそのまま、それ以外は scene.json を基準に file:// URL 化。 */
function resolveSrc(src, sceneDir) {
  if (!src) return null;
  if (/^(data:|https?:|file:)/i.test(src)) return src;
  return pathToFileURL(path.resolve(sceneDir, src)).href;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.scene || !args.out) usage();

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(args.scene, 'utf8'));
  } catch (e) {
    process.stderr.write(`✗ シーンJSON読込失敗: ${e.message}\n`);
    process.exit(1);
  }

  /** src の絶対URL化（scene.json 基準） → buildScene（z 安定ソート等は core） */
  const sceneDir = path.dirname(path.resolve(args.scene));
  const layers = (Array.isArray(raw.layers) ? raw.layers : []).map((l) =>
    (l && l.type === 'img') ? { ...l, src: resolveSrc(l.src, sceneDir) } : l
  );
  const scene = buildScene({ canvas: raw.canvas ?? {}, layers });

  /** 構造検証 + src 実在検証 */
  const structure = checkScene(scene);
  structure.problems.forEach((p) => process.stderr.write(`  ${p.level === 'error' ? '✗' : '⚠'} [${p.code}] ${p.msg}${p.id ? `（layer: ${p.id}）` : ''}\n`));

  scene.layers.forEach((l) => {
    if (l.type !== 'img' || !l.src || !l.src.startsWith('file:')) return;
    const pathname = l.src.slice('file://'.length);
    if (!fs.existsSync(pathname)) {
      structure.problems.push({ level: 'error', code: 'img-file-missing', id: l.id, msg: `画像が存在しない: ${pathname}` });
      process.stderr.write(`  ✗ [img-file-missing]（layer: ${l.id}）: ${pathname}\n`);
    }
  });
  structure.ok = structure.ok && !structure.problems.some((p) => p.level === 'error');

  if (args.check) {
    if (!structure.ok) { process.stderr.write('✗ --check NG\n'); process.exit(2); }
    process.stdout.write(`✓ --check OK (layers=${scene.layers.length})\n`);
    process.exit(0);
  }
  if (!structure.ok) { process.exit(2); }

  /** HTML 組み立て・書き出し（PNG と同じ名前の .html が既定） */
  const html = renderHTML(scene);
  const htmlPath = args.html ?? (args.skipHtml ? null : args.out.replace(/\.(png|jpg|jpeg|webp)$/i, '.html'));
  const pngPath = path.resolve(args.out);

  if (htmlPath) {
    fs.writeFileSync(htmlPath, html);
    process.stdout.write(`✓ ${htmlPath}  (${(html.length / 1024).toFixed(1)}KB, ${scene.layers.length} layers)\n`);
  }

  /** Chrome 焼き */
  const chrome = findChrome();
  if (!chrome) {
    // @why: [2026-08-31] --check を外した普通の実行なら、Chrome が無いと PNG を焼けない。HTML があれば成功表示、なければ失敗。
    process.stderr.write('✗ Chrome が見つからないため PNG 焼きをスキップ（HTMLのみ出力）\n');
    process.exit(htmlPath ? 0 : 1);
  }

  // 焼き用 HTML パス（--skip-html 時も一時ファイルが必要）
  let burnHtml = htmlPath;
  if (!burnHtml) {
    burnHtml = path.join(os.tmpdir(), `image-compose-${process.pid}.html`);
    fs.writeFileSync(burnHtml, html);
  }
  const fileUrl = 'file://' + path.resolve(burnHtml);

  // @why: [2026-08-31] ウィンドウは canvas より少し大きめ（最小480px制約を避けつつ不要な余白なし）。
  //       透明PNGは --default-background-color=00000000（canvas.bg が transparent のときだけ、余白も含め透明）。
  const winW = Math.max(480, scene.canvas.w + 2);
  const winH = Math.max(600, scene.canvas.h + 2);
  const chromeArgs = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    '--allow-file-access-from-files', // ローカル画像読込の要（無いと白飛び）
    '--disable-background-networking', '--disable-default-apps', '--no-first-run',
    '--no-default-browser-check', '--disable-component-extensions-with-background-pages',
    '--virtual-time-budget=2000',
  ];
  if (isTransparentBg(scene.canvas.bg)) chromeArgs.push('--default-background-color=00000000');
  chromeArgs.push('--screenshot=' + pngPath, `--window-size=${winW},${winH}`, fileUrl);

  execFileSync(chrome, chromeArgs);
  if (!fs.existsSync(pngPath)) {
    process.stderr.write('✗ PNG が出力されませんでした\n');
    process.exit(1);
  }

  // @why: [2026-08-31] Chrome は最小ウィンドウ480x600 のため、小さい canvas や 2px 余白で PNG が canvas より大きくなる。
  //       ゲームアセット等で「canvas ちょうどサイズ」が必要なため、magick で canvas サイズに left-top クロップする。
  //       クロップ座標は body 左上を 0,0 として canvas がそこに置かれる前提（canvas div は overflow:hidden で外に出ない）。
  //       magick が無ければそのまま（サイズは大きいままで、警告）。
  const magick = findInPath('magick');
  if (magick) {
    const r = spawnSync(magick, [pngPath, '-crop', `${scene.canvas.w}x${scene.canvas.h}+0+0`, '+repage', pngPath]);
    if (r.status === 0) {
      const ckb = (fs.statSync(pngPath).size / 1024).toFixed(1);
      console.log(`  ↳ canvas サイズにクロップ（${scene.canvas.w}x${scene.canvas.h}, ${ckb}KB）`);
    } else {
      process.stderr.write('  ⚠ magick -crop に失敗（サイズ補正せず）\n');
    }
  } else {
    process.stderr.write('  ⚠ magick が無いため PNG は Chrome 最小ウィンドウサイズ以上になることがある（canvas ちょうどにしたい場合は magick -crop を掛けてください）\n');
  }
  const kb = (fs.statSync(pngPath).size / 1024).toFixed(1);
  console.log(`✓ ${pngPath}  (${kb}KB)`);
}

main();