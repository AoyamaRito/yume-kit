// fal-h3 smoke test — CLI が起動しヘルプを出せるか（API キー不要・課金なし）
// @why: [2026-09-06] ベンチ環境で fal-h3 が動くことの保証（依存ゼロ・スモーク・実生成は行わない）
// @tags: SPEC, e2e, fal-h3
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'h3.mjs');

const out = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
assert.ok(/prompt|usage|使い方|--/i.test(out), 'ヘルプが出力されるべき');

console.log('fal-h3 smoke: PASS');