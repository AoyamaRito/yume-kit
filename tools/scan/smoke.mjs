// scan smoke test — 仕様マーカーを抽出できるか
// @why: [2026-09-06] ベンチ環境で scan が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, scan
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scanFile, COMMENT_LINE_RE, EXT_SCAN } from './scan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 定数の存在
assert.ok(COMMENT_LINE_RE instanceof RegExp);
assert.ok(EXT_SCAN.has('.mjs'));

// スキャン: 一時ファイル
import fs from 'node:fs';
import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-e2e-'));
const f = path.join(tmp, 'sample.mjs');
fs.writeFileSync(f, '// @why: テスト理由\n// @tags: SPEC\nexport function foo() {}\n');

const hits = [];
scanFile(f, 'sample.mjs', hits);
assert.ok(hits.length >= 2, '@why と @tags の両マーカーを拾うべき');
assert.ok(hits.some(h => h.reason?.includes('テスト理由')), 'reason が抽出されるべき');
assert.ok(hits.some(h => h.tags === 'SPEC'), 'tags が抽出されるべき');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('scan smoke: PASS');