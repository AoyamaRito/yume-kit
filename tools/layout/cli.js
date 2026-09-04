#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// map of meaning — cli.js
// 責務: JSON入力 → buildLayout/renderHTML/autoFixCollisions を呼び、HTML/PNG/report.json を出す。
//       AIエージェントループ用の終了コード（0=OK、2=NG）を提供。
//
// コマンド入口（main(argv)）:
//   node cli.js <spec.json> [-o out.html] [--png]                  # 生成
//   node cli.js <spec.json> --check [--report out.json]            # 検証（終了コード 0/2）
//   node cli.js <spec.json> --fix [--save-fix fixed.json]          # 衝突を自動退避
//   node cli.js <spec.json> <生成/検証/修復フラグ…>                # compose可
//

// 任意のローカルファイルパスを data URI に詰める（--embed 用）。
//   仕様: 空、URL、data: で始まる はそのまま返す。
//   拡張子から MIME を判定し base64に変換。
// @why: [2026-08-26] 「受領後のHTMLをダブルクリックで見れる」を実現するため導入。
//       --embed 指定時のみ layers.src を data URI に置換し、既存ロジックは破壊しない。
function embedDataUri(specPath, src) {
  if (!src) return src;
  if (src.startsWith('data:')) return src;
  if (/^https?:/i.test(src)) return src;
  let abs;
  try {
    if (existsSync(src)) abs = src;
    else abs = resolve(dirname(specPath), src);
    if (!existsSync(abs)) return src;
  } catch (_) { return src; }
  let buf;
  try { buf = readFileSync(abs); } catch (_) { return src; }
  const lower = abs.toLowerCase();
  let mime = 'application/octet-stream';
  if (lower.endsWith('.png')) mime = 'image/png';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
  else if (lower.endsWith('.gif')) mime = 'image/gif';
  else if (lower.endsWith('.webp')) mime = 'image/webp';
  else if (lower.endsWith('.svg')) mime = 'image/svg+xml';
  const b64 = buf.toString('base64');
  return `data:${mime};base64,${b64}`;
}

// 公開しているのは main(arg: argv) のみ（それ以外は内部関数）。
//
// 壊してはいけない性質（HANDOFF §4 と一致）:
//   - --check は「oob=0 かつ collision=0」のときexit 0、それ以外は exit 2。
//   - --report は機械可読JSONファイルを上書き生成（中身は固定スキーマではないがok/oob/collisionsが基本）。
//   - --png は Chrome / Chromium の google-chrome / chromium / chrome のどれか必須（不存在は終了）。
//   --fix は決定的に動作し、同一入力に対し同一候補を選ぶ（疑似乱数を含まない）。
//   - --save-fix は指定パスにJSON書き出し（同名時上書き）。
//   - --embed は --embed 不指定時と同じ HTML を出す（既存ロジックと等価）。
//   - --embed 指定時のみ layers.src が data URI に置換され、再帰（ data: を再変換）もスキップされる。
//   - 読めない src はそのまま残し、img-fallback HTML に任せる（エンタープライズ生成を止めない）。
//
// AIが観測する手順:
//   cd layout-cli
//   node cli.js examples/cover.json -o /tmp/c.html --png
//   node cli.js examples/alignment-demo.json --check --report /tmp/r.json
//   echo $?       # 期待値: 0
//   node cli.js examples/collision-demo.json --check
//   echo $?       # 期待値: 2
// ─────────────────────────────────────────────────────────────────

/**
 * layout-cli/cli.js — 「レイヤーで縦書き・横書きを配置」するCLI。
 *
 * 使い方:
 *   node cli.js spec.json            # spec.json → out.html
 *   node cli.js spec.json -o out.html
 *   node cli.js spec.json --png      # Chrome headless で PNG 出力
 *   node cli.js spec.json --fix      # 衝突を自動修復して安全位置へ自動退避
 *
 * 入力仕様 (JSON):
 *   {
 *     "page": { "w": "210mm", "h": "297mm", "margin": "15mm", "bg": "#f6f1e5" },
 *     "layers": [ ... ]
 *   }
 *   または複数ページ:
 *   { "pages": [ { "layers": [...] }, { "layers": [...] } ] }
 *
 * // @why: [2026-08-26] AI が JSON を渡す→HTML/PNG が決定的にできる用途。
 * //       AI自律修復機能（--fix）により、衝突検知したレイヤーを自動で安全位置へシフトして再出力。
 * // @tags: SPEC
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLayout, renderHTML, autoFixCollisions, toPt } from './core.js';
import { renderAscii } from './ascii.js';

function usage() {
  console.log(`layout-cli — レイヤーで縦書き/横書きを配置
使用法: node cli.js <spec.json> [options]
  -o, --out <file>     出力HTML (既定: out.html)
  --png                追加で Chrome headless で PNG 出力 (既定: -o の .png)
  --fix                検出した衝突を自動修復（退避）して出力
  --save-fix <file>    修復後のJSONを保存
  --check              oob/衝突があれば終了コード2（CI/AIループ用)
  --report <file>      診断結果をJSON保存
  --ascii              レイヤ配置をターミナル用 ASCII 鳥瞰図で stdout に出す（編集・生成はしない）
  --ascii-width <n>    --ascii の出力幅（文字数。既定 80）
  --zoom <x,y,w,h>     --ascii で指定領域(pt)を画面いっぱいに拡大 (例: 110.5,85,60,80)
  --zoom-into-collision  --ascii で衝突1件ごとに自動拡大ビューを出す
  --embed, --inline-images  画像を data URI 化して単体HTMLにする
  --page-size <w> <h>   size: シート を 印刷 / PDF 用に固定 (例: "120mm 70mm")
  --title <str>        ページタイトル
`);
}

function main(argv) {
  const args = [...argv];
  const specPath = args.find((a) => a && !a.startsWith('-'));
  if (!specPath) { usage(); process.exit(1); }
  const out = args.includes('-o') ? args[args.indexOf('-o') + 1] : args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out.html';
  const asPng = args.includes('--png');
  const doFix = args.includes('--fix');
  const check = args.includes('--check');
  const ascii = args.includes('--ascii');
  const asciiWidth = args.includes('--ascii-width') ? parseInt(args[args.indexOf('--ascii-width') + 1], 10) : 80;
  const zoomIntoCollision = args.includes('--zoom-into-collision');
  let zoom = null;
  {
    const idx = args.indexOf('--zoom');
    if (idx >= 0) {
      const p = (args[idx + 1] || '').split(',').map((s) => parseFloat(s));
      if (p.length === 4 && p.every((n) => Number.isFinite(n) && n >= 0)) {
        // 入力は mm 指定とみなし pt に変換（spec は mm 表記が主流のため）。
        zoom = { x: toPt(`${p[0]}mm`), y: toPt(`${p[1]}mm`), w: toPt(`${p[2]}mm`), h: toPt(`${p[3]}mm`) };
      } else {
        console.warn('⚠ --zoom は <x,y,w,h> のmm数値4つで指定してください (例: 20,30,40,60)');
      }
    }
  }
  const saveFixPath = args.includes('--save-fix') ? args[args.indexOf('--save-fix') + 1] : null;
  const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
  const title = args.includes('--title') ? args[args.indexOf('--title') + 1] : 'layout';
  const doEmbed = args.includes('--embed') || args.includes('--inline-images');
  let pageSize = null;
  {
    const idx = args.indexOf('--page-size');
    if (idx >= 0) {
      // "120mm 70mm" のような 2 トークンを連結受け入れ（スペースはそのまま残す）。
      const w = args[idx + 1];
      const h = args[idx + 2];
      pageSize = (w && h) ? `${w} ${h}` : (w || null);
    }
  }

  let raw;
  try { raw = JSON.parse(readFileSync(specPath, 'utf8')); }
  catch (e) { console.error(`spec 読込失敗: ${e.message}`); process.exit(1); }

  // 自動衝突修復 (--fix)。複数ページもページ単位で同じ処理を行う。
  if (doFix && (Array.isArray(raw.layers) || Array.isArray(raw.pages))) {
    const preLayout = buildLayout(raw);
    const allFixes = [];

    if (preLayout.isMultiPage) {
      raw.pages.forEach((rawPage, pageIndex) => {
        const pageLayout = preLayout.pages[pageIndex];
        if (!pageLayout.collisions.length) return;
        const { layers: fixedLayers, fixesApplied } = autoFixCollisions(pageLayout.layers, pageLayout.w, pageLayout.h);
        const rawLayers = Array.isArray(rawPage.layers) ? rawPage.layers : [];
        fixedLayers.forEach((fixed) => {
          const fixedIndex = pageLayout.layers.findIndex((l) => l.id === fixed.id);
          const source = rawLayers[fixedIndex];
          if (source) {
            // 修正した座標だけ元仕様へ反映し、作者の指定（text/kerning等）は保持。
            source.x = `${fixed.x}pt`;
            source.y = `${fixed.y}pt`;
          }
        });
        fixesApplied.forEach((f) => allFixes.push({ ...f, page: pageIndex + 1 }));
      });
    } else if (preLayout.collisions.length > 0) {
      const { layers: fixedLayers, fixesApplied } = autoFixCollisions(preLayout.layers, preLayout.w, preLayout.h);
      const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];
      fixedLayers.forEach((fixed) => {
        const fixedIndex = preLayout.layers.findIndex((l) => l.id === fixed.id);
        if (rawLayers[fixedIndex]) {
          rawLayers[fixedIndex].x = `${fixed.x}pt`;
          rawLayers[fixedIndex].y = `${fixed.y}pt`;
        }
      });
      allFixes.push(...fixesApplied);
    }

    if (allFixes.length > 0) {
      console.log(`🔧 自動衝突修復 (--fix): ${allFixes.length}件の要素を退避`);
      allFixes.forEach((f) => console.log(`   - ${f.page ? `[page ${f.page}] ` : ''}[${f.id}] ${f.action}`));
      if (saveFixPath) {
        writeFileSync(saveFixPath, JSON.stringify(raw, null, 2));
        console.log(`✓ 修復後JSON保存: ${saveFixPath}`);
      }
    }
  }

  const layout = buildLayout({ ...raw, title });

  // --embed 指定時: 画像 src を data URI に談めて単体 HTMLにする。
  //   layers.src は buildLayout 後のレイヤー上の値を直接上書きする。
  //   --embed 未指定ならノーオプ、既存ロジック不変。
  if (doEmbed) {
    const embedLayers = (ls) => ls.forEach((l) => { if (l && l.src) l.src = embedDataUri(specPath, l.src); });
    if (layout.isMultiPage) layout.pages.forEach((p) => embedLayers(p.layers));
    else embedLayers(layout.layers);
  }

  // @why: [2026-08-30] --ascii は「描画専用アウトサイドビュー」。HTML/PNG の代替ではなく、
  //       AI がレイアウト配置の重なり・はみ出しをトータルで見渡すための read-only ビュー。
  //       生成（HTML）と診断（--check/--report/警告）は下流でそのまま動く。
  if (ascii) {
    process.stdout.write(renderAscii(layout, { width: asciiWidth, zoom, zoomIntoCollision }) + '\n');
  } else {
    const html = renderHTML(layout, { title, pageSize });
    writeFileSync(out, html);

    const layerCount = layout.isMultiPage
      ? layout.pages.reduce((acc, p) => acc + p.layers.length, 0)
      : layout.layers.length;
    const pageCountInfo = layout.isMultiPage ? ` (${layout.pages.length} pages)` : '';

    console.log(`✓ ${out}  (${(html.length / 1024).toFixed(1)}KB, ${layerCount} layers${pageCountInfo})`);
    const operationCount = layout.isMultiPage
      ? layout.pages.reduce((acc, p) => acc + (p.operationChanges?.length || 0), 0)
      : (layout.operationChanges?.length || 0);
    if (operationCount) {
      console.log(`↔ 整列操作: ${operationCount}件適用`);
    }
  }

  // 設計診断（感覚器）
  if (layout.oob && layout.oob.length) {
    console.warn(`⚠ はみ出し (oob): ${layout.oob.map((o) => `${o.id}[${o.dir}] left:${o.left || 0} top:${o.top || 0} right:${o.right || 0} bottom:${o.bottom || 0}pt`).join(' / ')}`);
  }
  if (layout.unresolvedParents && layout.unresolvedParents.length) {
    console.warn(`⚠ 親レイヤー不明: ${layout.unresolvedParents.map((p) => `${p.id}->${p.parent}`).join(' / ')}`);
  }
  if (layout.isMultiPage) {
    const unresolved = layout.pages.flatMap((p, i) => (p.unresolvedParents || []).map((item) => ({ ...item, page: i + 1 })));
    if (unresolved.length) console.warn(`⚠ 親レイヤー不明: ${unresolved.map((p) => `[page ${p.page}] ${p.id}->${p.parent}`).join(' / ')}`);
  }
  if (layout.collisions && layout.collisions.length) {
    console.warn(`⚠ 衝突検知 (collision): ${layout.collisions.length}件`);
    layout.collisions.forEach((c) => {
      const tag = c.severity === 'error' ? '🚨 ERROR' : '⚡ WARN';
      console.warn(`   ${tag} [${c.idA}](${c.typeA}) ✕ [${c.idB}](${c.typeB})  重なり: ${c.overlapW}pt × ${c.overlapH}pt`);
    });
  }

  const diagnostic = {
    ok: layout.oob.length === 0 && layout.collisions.length === 0,
    oob: layout.oob,
    collisions: layout.collisions,
    operations: layout.isMultiPage
      ? layout.pages.flatMap((p, i) => (p.operationChanges || []).map((change) => ({ ...change, page: i + 1 })))
      : (layout.operationChanges || []),
    unresolvedParents: layout.isMultiPage
      ? layout.pages.flatMap((p, i) => (p.unresolvedParents || []).map((item) => ({ ...item, page: i + 1 })))
      : (layout.unresolvedParents || []),
    pages: layout.isMultiPage ? layout.pages.length : 1,
  };
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify(diagnostic, null, 2));
    console.log(`✓ 診断JSON: ${reportPath}`);
  }
  if (check && !diagnostic.ok) {
    console.error(`✗ --check NG: oob=${diagnostic.oob.length}, collision=${diagnostic.collisions.length}`);
    process.exitCode = 2;
  }

  if (asPng && !ascii) {
    const png = out.replace(/\.html?$/, '') + '.png';
    const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      .find(existsSync);
    if (!chrome) { console.error('Chrome が見つからないため --png をスキップ'); process.exit(0); }
    const fileUrl = 'file://' + process.cwd() + '/' + out;
    // @why: [2026-08-27] Chrome headless の最小ビューポート制約（約480px）と .page の中央マージン（margin:20px auto）を考慮し、
    //       カードがはみ出さず美しく中央に収まるよう十分なウィンドウサイズを確保。
    const winW = Math.max(480, Math.ceil(layout.w * 96 / 72 + 60));
    const winH = Math.max(600, Math.ceil(layout.h * 96 / 72 + 60));
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      '--disable-background-networking',
      '--disable-default-apps',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-component-extensions-with-background-pages',
      '--virtual-time-budget=2000',
      '--screenshot=' + png,
      `--window-size=${winW},${winH}`,
      fileUrl,
    ]);
    console.log(`✓ ${png}`);
  }
}

main(process.argv.slice(2));