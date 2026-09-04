#!/usr/bin/env node
// @why: [2026-09-04] プレゼンスキル化（HTML パワポ風）。ユーザー要望「プレゼンを作る機会が多いのでスキル化したい。HTML で作成するほうがいい、パワポ風にする」。
//       既有実績 presentations/design-system-presentation.html（←→キー遷移・テーマ切替・フィボナッチ余白）を雛形に、
//       JSON スライド定義 → 単一 HTML を生成する依存ゼロ CLI。clearify: 毎回デザインを 0 から考えるコストを消す。
// @why: [2026-09-06] 決裁資料の読みやすさ改善：h1/subtitle/li/note のフォントサイズを拡大（上長・判断者向けは少枚数＋大きい字が効果的）。templateHtmlWith に不足していた .note スタイルも追加（参考資料スライドで note を使用するため）。
// @why: [2026-09-06] refs フィールドを追加：各スライド下部に小さく関連情報（URL 自動リンク）を置けるようにした。まとめスライドを廃し「そのスライドの下に直接」置くスタイル（しつこくない程度・小さく薄く）。
// @why: [2026-09-06] table フィールドを追加：比較表（headers/rows/highlight）を構造化表示。決裁資料の「DeepSeek vs Gemini 価格比較」で使用。highlight 列をアクセント色で強調する。
// @why: [2026-09-06] templateHtmlWith に note 出力が欠落していたバグ修正（CLI 実走で文責・注記が表示されない原因）。buildHtml 側にはあったが templateHtmlWith 側に無くテストでも見落としていた。Test 9 で再発防止。
// @why: [2026-09-06] subtitleSmall フィールドを追加：長いサブタイトルを小さな字で 1 行に収める（決裁資料の比較スライドが 2 行に折返し崩れた事例を受けて）。
// @why: [2026-09-06] titleSmall フィールドを追加：長いタイトルも小さな字で 1 行に収められるようにした（subtitleSmall と同系の仕組み）。
// @why: [2026-09-06] bulletsSmall フィールドを追加：長い箇条書きのスライドで文字を小さくし、不自然な改行を防ぐ（「構成：無料のOSSツール＋プリペイドAPI」スライドの事例）。
// @why: [2026-09-06] 見出し（h1）を常に 1 行に収める fitH1 を追加。全タイトルは画面幅に応じて自動縮小し、見出しの折り返し・はみ出しを完全に防ぐ（ユーザー要望「見出しの改行はやめて」）。resize 時にも再適用。
// @why: [2026-09-03] images フィールドを追加：スクリーンショット等の写真をスライドに埋め込めるようにした（ユーザー要望「もっと写真とかまじえてわかりやすく」）。1スライド最大2枚を並べ、キャプション付き。src は出力 HTML からの相対パス（例: img/01-fal-home.jpg）。
// @tags: SPEC, PRESENTATION

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

/* ---------- テーマ（design-system 思想の一部を内蔵。tokens 相当） ---------- */
const THEMES = {
  vermilion: {
    label: '朱 — 決断・実行・日本',
    paper: '#F5F3EF', paperDeep: '#EDE9E0', ink: '#1C1D1F', inkSoft: '#5C6675',
    accent: '#D9381E', accentSoft: 'rgba(217,56,30,0.08)', line: 'rgba(28,29,31,0.12)',
    bgDot: 'rgba(28,29,31,0.022)',
  },
  indigo: {
    label: '藍 — 知的・静謐・信頼',
    paper: '#F4F6F9', paperDeep: '#E5EBF2', ink: '#182030', inkSoft: '#4A5A72',
    accent: '#1E40AF', accentSoft: 'rgba(30,64,175,0.08)', line: 'rgba(24,32,48,0.12)',
    bgDot: 'rgba(24,32,48,0.02)',
  },
  gold: {
    label: '金 — 註文・栄光・格式',
    paper: '#FAF7F0', paperDeep: '#F1E9D8', ink: '#3A3329', inkSoft: '#6B5F4E',
    accent: '#B8860B', accentSoft: 'rgba(184,134,11,0.1)', line: 'rgba(58,51,41,0.13)',
    bgDot: 'rgba(58,51,41,0.02)',
  },
  dark: {
    label: '漆黒 — 奥行・夜・没頭',
    paper: '#1B1E24', paperDeep: '#14171C', ink: '#E8E6E1', inkSoft: '#9AA3B2',
    accent: '#7FB3D8', accentSoft: 'rgba(127,179,216,0.12)', line: 'rgba(232,230,225,0.12)',
    bgDot: 'rgba(255,255,255,0.02)',
  },
};

/* ---------- PDF 自動生成（依存ゼロ：システムのヘッドレスブラウザを util） ---------- */
// @why: [2026-09-05] ユーザー要望「pdf化も自動で行われると最高だね」。HTML 生成と同時に PDF も自動生成する。
//       依存ゼロを守るため npm ライブラリは増やさず、macOS に在る Chrome / Edge / Chromium の headless print-to-pdf を利用。
//       HTML 側に @media print（全スライドを 1 ページずつ・16:9 固定）を内蔵し、それを headless ブラウザが印刷する形。
// @tags: SPEC, PRESENTATION
const PDF_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

function exportPdf(htmlPath, pdfPath) {
  const browser = PDF_BROWSERS.find(p => fs.existsSync(p));
  if (!browser) return { ok: false, reason: 'ヘッドレス PDF 対応ブラウザがありません（Chrome/Edge/Chromium を入れると自動 PDF が有効になります）' };
  fs.rmSync(pdfPath, { force: true });
  const url = pathToFileURL(path.resolve(htmlPath)).href;
  const run = (flag) => spawnSync(browser, [
    '--headless=new', '--disable-gpu',
    '--virtual-time-budget=4000',
    flag, `--print-to-pdf=${pdfPath}`, url,
  ], { encoding: 'utf8', timeout: 30000 });
  let r = run('--no-pdf-header-footer');          // Chrome 106+
  if (!fs.existsSync(pdfPath)) r = run('--print-to-pdf-no-header'); // 旧版 Chrome
  if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) return { ok: true };
  const err = (r.stderr || '').trim().split(/\n/).slice(0, 2).join(' ').slice(0, 160);
  return { ok: false, reason: `PDF 出力に失敗しました（${path.basename(browser)}）${err ? ': ' + err : ''}` };
}

/* ---------- HTML テンプレート（パワポ風：1画面1スライド・中央見出し・キー遷移） ---------- */
// @why: [2026-09-06] 古い buildHtml（未使用の重複テンプレート）を削除。現行は templateHtmlWith（export 済・fitH1 で見出しを 1 行化）のみを使う。Delete What, Keep Why。
/* ---------- ユーティリティ ---------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// @why: refs（スライド下部の参照情報）で URL を自動リンク化する。プレーンテキストに URL を書くだけで
//       クリック可能になり、表示もそのままなので誤リンク・切れリンクの心配が少ない（clearify: 探させない）。
function linkify(text) {
  return escapeHtml(String(text ?? '')).replace(/(https?:\/\/[^\s<>]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

// @why: [2026-09-06] 比較表サポート。headers/rows/highlight の3要素だけで表を組み立てる。
//       highlight 列（既定: 2列目＝提案サービス）をアクセント色で強調し、見るべき列を一瞬で判別させる。
function tableHtml(tbl) {
  const headers = tbl.headers || [];
  const rows = tbl.rows || [];
  const hl = tbl.highlight ?? 1;
  const th = headers.map((h, i) => `<th class="${i === hl ? 'hl' : ''}">${escapeHtml(h)}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map((c, i) => {
    const cls = i === 0 ? 'label' : (i === hl ? 'hl' : '');
    return `<td class="${cls}">${escapeHtml(c)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table>${th ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${trs}</tbody></table>`;
}

// @why: 生成ロジックを関数化しテストから呼べるようにする。THEMES は内部定数のまま、opts から直接受ける純粋関数。
// @targets: templateHtmlWith をテストから参照できるよう export（present-skill の構文検証・スライド内包検証に使う）
export function templateHtmlWith(slides, themeKey, title = 'プレゼンテーション') {
  const t = THEMES[themeKey] || THEMES.vermilion;
  const slideHtml = slides.map((s, idx) => {
    const body = [];
    if (s.title) body.push(`<h1 class="${s.titleSmall ? 'small' : ''}">${escapeHtml(s.title)}</h1>`);
    if (s.subtitle) body.push(`<div class="subtitle${s.subtitleSmall ? ' small' : ''}">${escapeHtml(s.subtitle)}</div>`);
    if (s.bullets?.length) {
      body.push(`<ul class="${s.bulletsSmall ? 'small' : ''}">${s.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
    }
    if (s.table) body.push(tableHtml(s.table));
    if (s.code) body.push(`<pre><code>${escapeHtml(s.code)}</code></pre>`);
    if (s.images?.length) {
      const figs = s.images.map(img => {
        const src = typeof img === 'string' ? img : img.src;
        const cap = typeof img === 'string' ? '' : (img.caption || '');
        return `<figure class="shot"><img src="${escapeHtml(src)}" alt="${escapeHtml(cap)}"/><figcaption>${escapeHtml(cap)}</figcaption></figure>`;
      }).join('');
      body.push(`<div class="shots">${figs}</div>`);
    }
    if (s.note) body.push(`<p class="note">※ ${escapeHtml(s.note)}</p>`);
    if (s.refs?.length) body.push(`<div class="refs">${s.refs.map(r => linkify(r)).join('<br>')}</div>`);
    return `<section class="slide${idx === 0 ? ' active' : ''}" data-i="${idx}"><div class="slide-inner">${body.join('\n')}</div></section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ja" data-theme="${themeKey}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --paper: ${t.paper}; --paper-deep: ${t.paperDeep}; --ink: ${t.ink}; --ink-soft: ${t.inkSoft};
          --accent: ${t.accent}; --accent-soft: ${t.accentSoft}; --line: ${t.line};
          --serif: "Shippori Mincho","Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif;
          --sans: "Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body { background: var(--paper); color: var(--ink); font-family: var(--sans); overflow: hidden; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0 0.3rem; font-size: clamp(0.95rem, 1.9vw, 1.2rem); }
  th, td { padding: 0.55em 0.9em; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
  thead th { border-bottom: 2px solid var(--accent); font-weight: 700; }
  td.label { color: var(--ink-soft); white-space: nowrap; }
  th.hl, td.hl { background: var(--accent-soft); font-weight: 700; }
  .slide { display: none; width: 100vw; height: 100vh; padding: 8vh 9vw; }
  .slide.active { display: flex; flex-direction: column; align-items: center; }
  .slide-inner { max-width: 1100px; width: 100%; margin-top: auto; margin-bottom: auto; }
  .refs { width: 100%; max-width: 1100px; margin-top: auto; padding-top: 1.1rem; border-top: 1px solid var(--line); color: var(--ink-soft); font-size: 0.85rem; line-height: 1.8; }
  .refs a { color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; }
  h1 { font-family: var(--serif); font-size: clamp(2.4rem, 6vw, 4.2rem); line-height: 1.4; margin-bottom: 1.4rem; }
  h1.small { font-size: clamp(1.6rem, 3.4vw, 2.4rem); }
  .subtitle { font-size: clamp(1.3rem, 2.6vw, 1.7rem); color: var(--accent); margin-bottom: 1.8rem; font-weight: 600; }
  ul { list-style: none; padding: 0; }
  li { position: relative; padding-left: 1.6em; margin: 0.8em 0; font-size: clamp(1.25rem, 2.6vw, 1.6rem); line-height: 1.6; }
  ul.small li { font-size: clamp(0.92rem, 1.8vw, 1.15rem); line-height: 1.75; margin: 0.55em 0; }
  li::before { content: "●"; position: absolute; left: 0; color: var(--accent); font-size: 0.55em; top: 0.55em; }
  pre { background: var(--paper-deep); border: 1px solid var(--line); border-radius: 8px; padding: 1em; font-size: 0.85rem; overflow: auto; }
  .note { margin-top: 1.2rem; color: var(--ink-soft); font-size: 1rem; }
  .progress { position: fixed; bottom: 0; left: 0; height: 4px; background: var(--accent); z-index: 10; }
  .counter { position: fixed; bottom: 12px; right: 20px; color: var(--ink-soft); font-size: 0.8rem; z-index: 10; }
  .subtitle.small { font-size: clamp(0.95rem, 1.9vw, 1.2rem); }
  /* @why: [2026-09-03] images フィールド用スタイル。写真（スクリーンショット）を中央に並べ、最大高を抑えて画面内に収める。 */
  .shots { display: flex; gap: 1.5rem; justify-content: center; align-items: flex-start; flex-wrap: wrap; width: 100%; max-width: 1100px; margin-top: 1rem; }
  .shot { flex: 1 1 300px; max-width: 520px; text-align: center; }
  .shot img { width: 100%; max-height: 54vh; object-fit: contain; border: 1px solid var(--line); border-radius: 6px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.06); }
  .shot figcaption { margin-top: 0.7rem; font-size: clamp(0.85rem, 1.6vw, 1rem); color: var(--ink-soft); line-height: 1.6; }
  /* @why: [2026-09-05] PDF 自動生成（印刷用）。画面では active のみ表示だが、印刷時は全スライドを 1 ページずつ出す。
     16:9 (=1280x720) の fixed レイアウト + page break を、headless ブラウザ（Chrome）の print-to-pdf が忠実に PDF 化する。 */
  @page { size: 1280px 720px; margin: 0; }
  @media print {
    html, body { height: auto; overflow: visible; }
    .progress, .counter { display: none; }
    .slide { display: flex; flex-direction: column; align-items: center; justify-content: center;
             width: 1280px; height: 720px; padding: 64px 100px;
             break-after: page; page-break-after: always; }
    .slide:last-of-type { break-after: auto; page-break-after: auto; }
  }
</style>
</head>
<body>
  <div class="progress" id="progress" style="width:${100 / Math.max(1, slides.length)}%"></div>
  <div class="counter" id="counter">1 / ${slides.length}</div>
${slideHtml}
<script>
  const slides = document.querySelectorAll('.slide');
  const total = slides.length;
  let i = 0;
  function fitH1(el) {
    if (!el) return;
    el.style.whiteSpace = 'nowrap';
    el.style.fontSize = '';
    const max = parseFloat(getComputedStyle(el).fontSize) || 40;
    let size = max;
    el.style.fontSize = size + 'px';
    while (el.scrollWidth > el.clientWidth + 1 && size > 11) { size -= 2; el.style.fontSize = size + 'px'; }
  }
  function go(n) {

    i = Math.max(0, Math.min(total - 1, n));
    slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
    document.getElementById('progress').style.width = ((i + 1) / total * 100) + '%';
    document.getElementById('counter').textContent = (i + 1) + ' / ' + total;
    fitH1(slides[i].querySelector('h1'));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { go(0); }
    else if (e.key === 'End') { go(total - 1); }
  });
  window.addEventListener('resize', () => fitH1(slides[i].querySelector('h1')));
  go(0);
</script>
</body>
</html>`;
}

// @why: CLI 本体を export しテストから直接呼べるようにする（snowball 検証のため）。argv は process.argv 互換の配列。
export async function main(argv) {
  const args = argv.slice(2);
  let input = null, out = null, theme = 'vermilion', title = null, pdf = true, doCheck = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out' || a === '-o') out = args[++i];
    else if (a === '--theme' || a === '-t') theme = args[++i];
    else if (a === '--title') title = args[++i];
    else if (a === '--no-pdf') pdf = false;
    else if (a === '--no-check' || a === '--skip-check') doCheck = false;
    else if (a === '--help' || a === '-h') {
      console.log(`present — HTML パワポ風プレゼン生成（依存ゼロ・yui 検証対応・PDF 自動生成・改行チェック自動）
使い方: node present.mjs <slides.json> [--out file.html|file.pdf] [--theme vermilion|indigo|gold|dark] [--title "..."] [--no-pdf] [--no-check]

既定は PDF も自動生成します（--no-pdf で HTML のみ）。
生成後に不自然な改行（孤立行・禁則）を自動チェックします（--no-check でスキップ）。
--out file.pdf と指定すると PDF をそこに置き、HTML は file.html になります。

slides.json 形式:
{
  "title": "プレゼンタイトル",
  "theme": "vermilion",
  "slides": [
    { "title": "スライロ1", "bullets": ["A", "B"] },
    { "title": "第二幕", "subtitle": "副題", "code": "const x = 1;", "note": "補足" }
  ]
}

検証は \`yui file.html\`（レイアウト破綻）と gen に組み込まれた改行チェックを確認できる。`);
      return 0;
    }
    else if (!a.startsWith('-')) input = a;
  }
  if (!input) { console.error('present: スライド定義 JSON を指定してください (--help 参照)'); return 1; }
  if (!fs.existsSync(input)) { console.error(`present: ファイルが見つかりません: ${input}`); return 1; }
  let def;
  try { def = JSON.parse(fs.readFileSync(input, 'utf8')); }
  catch (e) { console.error('present: JSON パース失敗:', e.message); return 1; }
  const slides = def.slides || [];
  if (!slides.length) { console.error('present: slides 配列が空です'); return 1; }
  theme = def.theme || theme;
  title = def.title || title || 'プレゼンテーション';
  const html = templateHtmlWith(slides, theme, title);
  const dest = out || 'presentation.html';
  const asPdf = /\.pdf$/i.test(dest);
  const htmlPath = asPdf ? dest.replace(/\.pdf$/i, '.html') : dest;
  const pdfPath = asPdf ? dest : dest.replace(/\.html?$/i, '') + '.pdf';
  fs.writeFileSync(htmlPath, html);
  console.log(`✅ HTML 生成: ${path.resolve(htmlPath)}（${slides.length} スライド / テーマ: ${theme}）`);
  if (pdf) {
    const r = exportPdf(htmlPath, pdfPath);
    if (r.ok) console.log(`✅ PDF 生成: ${path.resolve(pdfPath)}`);
    else console.log(`   PDF 生成スキップ: ${r.reason}`);
  } else {
    console.log('   PDF 生成: なし（--no-pdf 指定）');
  }

  // @why: [2026-09-05] ユーザー要望「改行チェックを毎回お願いしたい」→ 生成後に自動で check-linebreak を回す（read-only・ヒント。--no-check でスキップ可）。
  // @tags: SPEC
  if (doCheck) {
    const { checkLinebreaks } = await import('./check-linebreak.mjs');
    try {
      const lb = await checkLinebreaks(htmlPath, { width: 1280, height: 800 });
      if (lb.ok) {
        console.log(`✅ 改行チェック: 不自然な折り返しなし`);
      } else {
        console.log(`⚠️ 改行チェック: 不自然な折り返し ${lb.issues.length} 件（--no-check で表示抑制。yui などで確認）`);
        const byEl = new Map();
        for (const it of lb.issues) {
          if (!byEl.has(it.el)) byEl.set(it.el, []);
          byEl.get(it.el).push(it);
        }
        for (const [el, its] of byEl) {
          for (const it of its.slice(0, 3)) console.log(`     · ${el} L${it.line} ${it.issue}「${it.char}」`);
        }
      }
    } catch (e) {
      console.log(`   改行チェック: スキップ（${e.message?.slice(0, 60)}）`);
    }
  }
  console.log(`  検証: yui ${path.basename(htmlPath)}（レイアウト破綻チェック）`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((c) => { process.exitCode = c; });
}