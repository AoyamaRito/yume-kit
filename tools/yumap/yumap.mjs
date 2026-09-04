#!/usr/bin/env node
// @why: [2026-09-04] 推奨アクション①「トークン予算内レポマップ」。Aider の repo-map 相当を依存ゼロで実現し、初見の大規模プロジェクトを yumap <dir> 一発で構造俯瞰できるようにする（clearify: AI に探させない）。yspec（@why 俯瞰・read-only）と相補で、こちらは「関数/クラス/テスト/HTML/CSS のシグネチャ行＋近傍 @why」の構造俯瞰。
// @tags: SPEC
// @why: scan.js の extractScopeName / EXT_SCAN を再利用（重複実装しない。単純なカプセル化はせず実体を import）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractScopeName, EXT_SCAN } from './scan.js';

// @why: トークン概算は実用近似（ASCII 4chars/1token・CJK 1.5chars/1token）。予算は軟制約で、超過時は行単位で切り捨てる。
const CJK_RE = /[\u3000-\u9FFF\uFF00-\uFFEF]/g;
export function approxTokens(str) {
  let ascii = 0;
  let cjk = 0;
  for (const ch of str) {
    if (CJK_RE.test(ch)) cjk++;
    else ascii++;
  }
  return Math.ceil(ascii / 4 + cjk / 1.5);
}

// @why: 依存・ビルド物は構造俯瞰のノイズなので除外（clearify: 探させない）
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '.venv', 'venv', '__pycache__', 'vendor', 'out',
]);

/**
 * ディレクトリを再帰走査しスコープ対象ファイルの絶対パス一覧を返す
 * @param {string} root
 * @returns {string[]}
 */
export function collectFiles(root) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out.push(...collectFiles(full));
    } else if (e.isFile()) {
      // @why: 複合拡張子 .yume.js は extname('.js') で拾えるが、一覧外の .html 等は EXT_SCAN で判定する。
      const base = e.name;
      const extHit = EXT_SCAN.has(path.extname(base)) || base.endsWith('.yume.js');
      if (extHit) out.push(full);
    }
  }
  return out.sort();
}

// @why: 近傍 @why / @tags 行（scan.js と同じコメント接頭辞ルール）
const WHY_LINE_RE = /^\s*(?:\/\/|\*|#|<!--|--)\s*@why\s*:\s*(.+)$/i;
const TAGS_LINE_RE = /^\s*(?:\/\/|\*|#|<!--|--)\s*@tags\s*:\s*(.+)$/i;

/**
 * 1 ファイルの構造俯瞰エントリを抽出
 * @param {string} absFile
 * @returns {{line:number, text:string, isMeta:boolean}[]}
 */
export function scanMapFile(absFile) {
  const text = fs.readFileSync(absFile, 'utf8');
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const why = line.match(WHY_LINE_RE);
    if (why) { out.push({ line: i + 1, text: `@why: ${why[1].trim().slice(0, 140)}`, isMeta: true }); continue; }
    const tags = line.match(TAGS_LINE_RE);
    if (tags) { out.push({ line: i + 1, text: `@tags: ${tags[1].trim()}`, isMeta: true }); continue; }
    const name = extractScopeName(line);
    if (!name) continue;
    const sig = line.trim().replace(/\s+/g, ' ').slice(0, 160);
    out.push({ line: i + 1, text: `${sig}`, isMeta: false });
  }
  return out;
}

/**
 * ファイルごとにまとめ、トークン予算内に収める。ファイル内では行順どおり。
 * @param {{file:string, entries:{line:number,text:string,isMeta:boolean}[]}} all
 * @param {number} maxTokens
 * @param {string} targetRoot 相对表示用ルート
 * @param {number} showDepth 表示階層（0=全部）
 */
export function summarize(all, maxTokens, targetRoot, showDepth) {
  const lines = [];
  let used = 0;
  for (const { file, entries } of all) {
    let rel = path.relative(targetRoot, file);
    if (showDepth > 0) {
      const parts = rel.split(path.sep);
      rel = parts.slice(-showDepth).join(path.sep);
    }
    lines.push(`# ${rel}`);
    for (const e of entries) {
      const cost = approxTokens(e.text);
      if (used + cost > maxTokens && !e.isMeta) continue; // 構造行が予算を超えたら切る（meta は安いので残る）
      if (used + cost > maxTokens && e.isMeta) continue;   // それでも超えるメタは切る（安全）
      lines.push(`  L${e.line}  ${e.text}`);
      used += cost;
    }
  }
  lines.push('', `--- files: ${all.length} / tokens used（概算）: ${used} / budget: ${maxTokens}`);
  return lines.join('\n');
}

export function main(argv) {
  const args = argv.slice(2);
  let target = '.';
  let maxTokens = 2000;
  let showDepth = 4;
  let asJson = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--max-tokens' || a === '-m') maxTokens = Math.max(100, Number(args[++i]) || 2000);
    else if (a === '--depth' || a === '-d') showDepth = Math.max(0, Number(args[++i]) || 0);
    else if (a === '--json') asJson = true;
    else if (a === '--help' || a === '-h') {
      console.log(`yumap — トークン予算内レポマップ（構造俯瞰・read-only）
使い方: node yumap.mjs <dir> [--max-tokens N] [--depth N] [--json]
  <dir>          走査するディレクトリ（既定 .）
  --max-tokens N トークン予算（概算、既定 2000）
  --depth N      相对表示の深さ（既定 4。0=全部）
  --json         全エントも JSON で dump`);
      return 0;
    }
    else if (!a.startsWith('-')) target = a;
  }

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error(`yumap: ディレクトリが見つかりません: ${target}`);
    return 1;
  }

  const files = collectFiles(target);
  const all = [];
  for (const f of files) {
    try {
      const entries = scanMapFile(f);
      if (entries.length) all.push({ file: f, entries });
    } catch {
      // read 失敗は無視（read-only センサ）
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ target, files: files.length, entries: all }, null, 2));
    return 0;
  }

  console.log(`# yumap: ${path.resolve(target)}`);
  console.log(summarize(all, maxTokens, target, showDepth));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}