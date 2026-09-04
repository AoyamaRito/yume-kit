#!/usr/bin/env node
// @why: [2026-09-04] 推奨アクション②「静的感覚器」。E2E を回す前に、構文エラー・未解決 import・型エラーを機械的・瞬間的に指摘する read-only センサ。矯正ではなくヒント（検出してもブロックしない。exit 1 は「検出あり」の合図だけで、処理を止める強制ではない）。
// @tags: SPEC
// @why: node --check で構文、相対 import の実在解決で未解決参照、tsconfig があればプロジェクトローカル tsc --noEmit（best-effort。グローバル tsc は前提にしない）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '.venv', 'venv', '__pycache__', 'vendor', 'out',
]);
const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.tsx', '.ts', '.mts', '.cts']);

// @why: 相対 import の解決候補（Node + bundler で一般的な変種を機械的に試す）。拡張子の補完・index 解決まで。
const IMPORT_RE = /(?:import\s+(?:[\w$]+\s*,\s*)?\{?[^}]*\}?\s+from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\))/g;
// より確実な2種: from 'x' / import 'x' / require('x')
const IMPORT_A = /from\s*["']([^"']+)["']/g;
const IMPORT_B = /(?:^|\s)import\s*["']([^"']+)["']/g;
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;

function isRelative(p) {
  return p.startsWith('./') || p.startsWith('../') || p === '.' || p === '..';
}

/**
 * import パスが相対実在するか解決を試みる
 * @param {string} baseDir 読み手ファイルのディレクトリ
 * @param {string} spec import 指定（相对 or 絶対拡張子なし）
 * @returns {string|null} 解決できた実パス or null
 */
export function resolveImport(baseDir, spec) {
  if (!isRelative(spec)) return null; // パッケージ import は解決対象外（node_modules 側）
  const candidates = [];
  const base = path.resolve(baseDir, spec);
  candidates.push(base);
  // 拡張子なし → 補完パターン
  const exts = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.json', '.node'];
  for (const ext of exts) candidates.push(base + ext);
  // ディレクトリ → index 解決
  for (const ext of exts) candidates.push(path.join(base, `index${ext}`));
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * 1ファイルの構文チェック（node --check）
 * @param {string} file
 * @returns {string|null} エラーメッセージ or null
 */
export function syntaxCheck(file) {
  const ext = path.extname(file);
  // JS 系のみ node --check 可能（.ts は node が直接読めないので tsc 側で見る）
  if (!['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) return null;
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe', encoding: 'utf8' });
    return null;
  } catch (e) {
    const stderr = e.stderr ? String(e.stderr) : String(e.message);
    // node --check の "SyntaxError: ..." 部分を抜く
    const m = stderr.match(/SyntaxError[^\n]*|Unexpected[^\n]*|Missing[^\n]*/i);
    return (m ? m[0] : stderr.split('\n')[0]).trim() || 'syntax error';
  }
}

/**
 * 1ファイルの import 文を走査し、未解決の相対 import を列挙
 * @param {string} file
 * @returns {string[]} 「L行: import 'x'」形式のメッセージ
 */
export function unresolvedImports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const baseDir = path.dirname(file);
  const problems = [];
  const collect = (spec, ln) => {
    if (!spec) return;
    if (!isRelative(spec)) return;
    if (!resolveImport(baseDir, spec)) {
      problems.push(`L${ln}: 未解決の import: '${spec}'`);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // コメント行は skip（簡易判定: 先頭の非空白が // か * か # か <!--）
    const t = line.trimStart();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#')) continue;
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(line)) !== null) {
      const spec = m[1] || m[2] || m[3];
      if (spec) collect(spec, i + 1);
    }
  }
  return problems;
}

/** 型チェック（プロジェクトローカル tsc --noEmit、best-effort） */
export function typeCheck(root) {
  const tsconfig = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(tsconfig)) return null;
  const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
  if (!fs.existsSync(tsc)) {
    return 'tsconfig.json はあるが node_modules/.bin/tsc がない（型チェックはスキップ・ヒントのみ）';
  }
  try {
    execFileSync(tsc, ['--noEmit'], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    return null;
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const lines = out.split('\n').filter((l) => l.trim() && !l.startsWith('$')).slice(0, 12);
    return 'typecheck で問題検出:\n' + lines.join('\n') || 'tsc 失敗';
  }
}

/**
 * ディレクトリ配下を走査して静的解析
 * @param {string} root
 * @returns {{syntax:{file:string,err:string}[], imports:{file:string,msg:string}[], tsc:string|null}}
 */
export function scanAll(root) {
  const files = collectJsFiles(root);
  const syntax = [];
  const imports = [];
  for (const f of files) {
    const serr = syntaxCheck(f);
    if (serr) syntax.push({ file: f, message: serr });
    for (const msg of unresolvedImports(f)) imports.push({ file: f, msg });
  }
  return { syntax, imports, tsc: typeCheck(root) };
}

export function collectJsFiles(root) {
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
      out.push(...collectJsFiles(full));
    } else if (e.isFile()) {
      if (JS_EXT.has(path.extname(e.name))) out.push(full);
    }
  }
  return out.sort();
}

export function main(argv) {
  const args = argv.slice(2);
  let target = '.';
  let asJson = false;
  for (const a of args) {
    if (a === '--json') asJson = true;
    else if (a === '--help' || a === '-h') {
      console.log(`ycheck — 静的感覚器（構文+import+型・read-only）
使い方: node ycheck.mjs <dir> [--json]
  <dir>  走査するディレクトリ（既定 .）
  --json 問題を JSON で出力（CI 連携用）`);
      return 0;
    }
    else if (!a.startsWith('-')) target = a;
  }

  if (!fs.existsSync(target)) { console.error(`ycheck: ディレクトリが見つかりません: ${target}`); return 1; }

  const res = scanAll(target);
  if (asJson) {
    console.log(JSON.stringify(res, null, 2));
    return res.syntax.length || res.imports.length || (res.tsc && res.tsc.startsWith('tsc で問題')) ? 1 : 0;
  }

  if (!res.syntax.length && !res.imports.length) {
    console.log(`ycheck: ${target} — 構文・import 問題なし${res.tsc ? ` / ${res.tsc}` : '' + '（型チェックなし）'}`);
    return 0;
  }
  console.log(`ycheck: ${target} — 問題あり（${res.syntax.length} 構文, ${res.imports.length} import, tsc=${res.tsc ? '実行' : 'なし'}）`);
  for (const s of res.syntax) console.log(`  [構文] ${relify(s.file, target)}: ${s.message}`);
  for (const im of res.imports) console.log(`  [import] ${relify(im.file, target)}: ${im.msg}`);
  if (res.tsc) console.log(`  [tsc] ${res.tsc.split('\n').slice(0, 4).join('\n    ')}`);
  return 1;
}

function relify(f, root) {
  try { return path.relative(root, f); } catch { return f; }
}

// @why: import された場合（test.mjs 等から）process.argv[1] が undefined になるため、直接実行時のみ起動するガード
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}