// ctxlog smoke test — write / ls / search が動くか（一時ファイル）
// @why: [2026-09-06] ベンチ環境で ctxlog が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, ctxlog
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxlog-e2e-'));
const logFile = path.join(tmp, 'ctxlog.jsonl');

// write
const w = execFileSync(process.execPath, [CLI, 'write', 'テストエントリ', '--summary', 'スモーク', '--file', logFile], { encoding: 'utf8' });
assert.ok(w.includes('テストエントリ'), 'write が成功するべき');

// ls
const ls = execFileSync(process.execPath, [CLI, 'ls', '--limit', '10', '--file', logFile], { encoding: 'utf8' });
assert.ok(ls.includes('テストエントリ'), 'ls にエントリが見えるべき');

// search
const s = execFileSync(process.execPath, [CLI, 'search', 'スモーク', '--file', logFile], { encoding: 'utf8' });
assert.ok(s.includes('テストエントリ'), 'search がヒットするべき');

// json 出力
const j = execFileSync(process.execPath, [CLI, 'ls', '--json', '--file', logFile], { encoding: 'utf8' });
const parsed = JSON.parse(j);
assert.ok(Array.isArray(parsed) && parsed.length >= 1, 'json 配列を返すべき');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ctxlog smoke: PASS');