#!/usr/bin/env node
// @why: [2026-09-05] ユーザー要望「プレゼンの変なところで改行が入るのが見苦しい。そのチェックを一瞬でできるツールが欲しい。毎回お願いしたい」→ HTML プレゼンの不自然な折り返しを実測する read-only センサ。
//       ヘッドレスブラウザで実際の折り返し位置を測り、禁則違反（行頭禁則・行末禁則）・英数単語の途中切れ・1文字孤立行を即時報告する。
//       矯正ではなくヒント（検出してもブロックしない）。依存は yume-kit ルートの playwright-core のみ（新規依存ゼロ）。
// @why: [2026-09-06] page.evaluate(DETECT_FN, sel) が undefined を返しクラッシュするバグ修正。Playwright の evaluate は第1引数が文字列だと「式」として評価され、関数式オブジェクトが戻り値になってしまい（serialize 不能→undefined）結果が入らない。文字列を即時実行形式 `(${DETECT_FN})(${sel})` に変更し、呼ぶべき関数の戻り値（issues）を得る。
// @tags: SPEC, PRESENTATION
// @why: 実測が必須な理由: CSS の折り返しは要素幅・フォント・言語で決まるため、テキスト解析だけでは正確な改行位置は分からない。実ブラウザで 1 文字ずつの位置を測るのが唯一の確実な方法（clearify: 主張ではなく実測）。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromiumPath } from '../../ui/index.js';

// 検査対象セレクタ
const TARGET_SELECTOR = 'h1,h2,h3,h4,h5,li,p,.subtitle,.note,blockquote,td,th';

// @why: 検出ロジック。関数として定義しそのまま evaluate に渡す（文字列シリアライズで正規表現が壊れるのを防ぐ）。
function detectIssues(selector) {
  // 行頭禁則: 句点・読点・閉じ括弧・約物・小書きかな・長音などが行頭に来ると見苦しい
  const badStart = /^[、。．・：；！？！」』）〕］｝〉》】ゝゞァィゥェォャュョッヵヶー—–]/;
  // 行末禁則: 開き括弧・「『 が行末に来ると続きが分断されて見える
  const badEnd = /[「（『｛〔［〈《【]$/;
  // 英数単語の途中切れ: 行末が英数で次行頭も英数
  const alphaEnd = /[A-Za-z0-9_]$/;
  const alphaStart = /^[A-Za-z0-9_]/;
  const results = [];

  function selectorOf(el) {
    if (el.id) return '#' + el.id;
    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) sel += '.' + cls;
    }
    return sel;
  }

  // テキストノードを行配列に分割（y 座標が変わる=改行）。文字単位で確実に測る（プローブで行数を省略すると誤判定するため常に走査）
  function linesOfTextNode(node) {
    const text = node.textContent;
    if (!text || !text.trim() || text.length === 0) return [];
    const lines = [];
    let cur = '';
    let curTop = null;
    for (let i = 0; i < text.length; i++) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const rect = r.getBoundingClientRect();
      if (rect.width === 0) { cur += text[i]; continue; }
      const top = Math.round(rect.top);
      if (curTop === null) curTop = top;
      if (top !== curTop) {
        lines.push(cur);
        cur = '';
        curTop = top;
      }
      cur += text[i];
    }
    if (cur) lines.push(cur);
    return lines;
  }

  document.querySelectorAll(selector).forEach((el) => {
    // @why: 見出し（h1〜h4）は 1 行が原則。折り返し自体を違反として検出する（ユーザー要望「見出しの改行はやめて」）
    const isHeading = /^H[1-4]$/.test(el.tagName);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const lines = linesOfTextNode(node);
      if (isHeading && lines.length >= 2) {
        results.push({ el: selectorOf(el), text: (node.textContent || '').replace(/\s+/g, ' ').slice(0, 60), issue: '見出し折り返し', char: `${lines.length}行`, line: 1 });
      }
      if (lines.length < 2) continue;
      const whole = (node.textContent || '').replace(/\s+/g, ' ');
      lines.forEach((ln, idx) => {
        if (!ln) return;
        const first = ln.charAt(0);
        const last = ln.charAt(ln.length - 1);
        if (idx > 0 && badStart.test(first)) {
          results.push({ el: selectorOf(el), text: whole.slice(0, 60), issue: '行頭禁則', char: first, line: idx + 1 });
        }
        if (badEnd.test(last)) {
          results.push({ el: selectorOf(el), text: whole.slice(0, 60), issue: '行末禁則', char: last, line: idx + 1 });
        }
        const nextFirst = (lines[idx + 1] || '').charAt(0);
        if (alphaEnd.test(last) && alphaStart.test(nextFirst)) {
          results.push({ el: selectorOf(el), text: whole.slice(0, 60), issue: '英数途中切れ', char: last + '→' + nextFirst, line: idx + 1 });
        }
        if (ln.length === 1) {
          results.push({ el: selectorOf(el), text: whole.slice(0, 60), issue: '1文字孤立行', char: ln, line: idx + 1 });
        }
      });
    }
  });

  return results;
}

/**
 * HTML ファイルの不自然な折り返しを実測検出
 * @returns {Promise<{ok:boolean, issues:any[], url:string}>}
 */
export async function checkLinebreaks(filePath, opts = {}) {
  const exe = opts.executablePath || findChromiumPath();
  if (!exe) throw new Error('Chromium 実行ファイルが見つかりません（yui と同じ要件）');
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;
  const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    const url = 'file://' + abs;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(opts.wait ?? 200);
    const issues = await page.evaluate(`(${detectIssues})(${JSON.stringify(TARGET_SELECTOR)})`);
    return { ok: issues.length === 0, issues, url: filePath };
  } finally {
    await browser.close();
  }
}

/* ---------- CLI ---------- */
export async function main(argv) {
  const args = argv.slice(2);
  let target = null;
  let width = 1280;
  let height = 800;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--width' || a === '-w') width = Number(args[++i]) || 1280;
    else if (a === '--height' || a === '-h') height = Number(args[++i]) || 800;
    else if (a === '--mobile' || a === '--small') { width = 390; height = 844; }
    else if (a === '--json') asJson = true;
    else if (a === '--help' || a === '-help') {
      console.log(`check-linebreak — HTML プレゼンの不自然な折り返しを実測検出（read-only・ヒント）
使い方: node check-linebreak.mjs <file.html> [--width 1280] [--height 800 | --mobile] [--json]

検出する問題:
  行頭禁則   … 行頭に 。、」』！？ などが来ている（\|見苦しい主因）
  行末禁則   … 行末に 「（『 などが来ている
  英数途中切れ … 英単語・数字が行の途中で分断されている
  1文字孤立行 … 1文字だけが次行に落ちている（widow 風）
  見出し折り返し … h1〜h4 が 2 行以上に折り返している（見出しは 1 行原則）

戻り値: exit 0=問題なし / 1=問題あり（検出してもブロックしない・ヒント）`);
      return 0;
    }
    else if (!a.startsWith('-')) target = a;
  }
  if (!target) { console.error('check-linebreak: HTML ファイルを指定してください (--help 参照)'); return 1; }
  if (!fs.existsSync(target)) { console.error(`check-linebreak: ファイルが見つかりません: ${target}`); return 1; }

  const res = await checkLinebreaks(target, { width, height });
  if (asJson) { console.log(JSON.stringify(res, null, 2)); return res.ok ? 0 : 1; }

  if (res.ok) {
    console.log(`✅ check-linebreak: ${target}（${width}x${height}）— 不自然な折り返しなし`);
    return 0;
  }
  console.log(`⚠️ check-linebreak: ${target}（${width}x${height}）— 不自然な折り返し ${res.issues.length} 件`);
  const byEl = new Map();
  for (const it of res.issues) {
    if (!byEl.has(it.el)) byEl.set(it.el, []);
    byEl.get(it.el).push(it);
  }
  for (const [el, its] of byEl) {
    console.log(`  [${el}]`);
    for (const it of its.slice(0, 6)) {
      console.log(`    · L${it.line} ${it.issue}「${it.char}」 — ${it.text}`);
    }
  }
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then((c) => { process.exitCode = c; });
}