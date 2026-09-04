// yumap smoke test — ディレクトリ構造と @why を俯瞰できるか
// @why: [2026-09-06] ベンチ環境で yumap が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, yumap
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'yumap.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yumap-e2e-'));

// @why: テスト用ファイル（yumap が @why を拾うべき）
fs.writeFileSync(path.join(tmp, 'a.mjs'), '// @why: テスト用\n// @tags: SPEC\nexport const a = 1;\n');
fs.writeFileSync(path.join(tmp, 'b.js'), 'function b() { return 2; }\n');

const out = execFileSync(process.execPath, [CLI, tmp, '--json'], { encoding: 'utf8' });
const parsed = JSON.parse(out);
assert.ok(parsed && (parsed.files || Array.isArray(parsed)), '構造化出力であるべき');
const text = typeof out === 'string' ? out : JSON.stringify(parsed);
assert.ok(text.includes('a.mjs'), 'a.mjs が見えるべき');
assert.ok(/@why|テスト用/.test(text), '@why が俯瞰に出るべき');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('yumap smoke: PASS');