// kantoku smoke test — CLI が起動しヘルプを出せるか（API キー不要）
// @why: [2026-09-06] ベンチ環境で kantoku が動くことの保証（依存ゼロ・スモーク・API 呼び出しなし）
// @tags: SPEC, e2e, kantoku
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'bin', 'kantoku.js');

const out = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
assert.ok(/kantoku|Usage|usage/i.test(out), 'ヘルプが出力されるべき');

console.log('kantoku smoke: PASS');