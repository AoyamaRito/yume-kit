// ycheck smoke test — 構文 OK/NG を検出できるか
// @why: [2026-09-06] ベンチ環境で ycheck が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, ycheck
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'ycheck.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ycheck-e2e-'));

// OK ファイル
fs.writeFileSync(path.join(tmp, 'ok.mjs'), 'export const a = 1;\nconsole.log(a);\n');
// NG ファイル（構文エラー）
fs.writeFileSync(path.join(tmp, 'ng.mjs'), 'export const = ;\n');

// 問題があれば exit code 1 で終了する（= 問題発見の正常動作）。それを検証する。
let threw = false;
let okJson = null;
try {
  const out = execFileSync(process.execPath, [CLI, tmp, '--json'], { encoding: 'utf8' });
  okJson = JSON.parse(out);
} catch (e) {
  threw = true;
  // 失敗時も stdout に JSON が入っている（構文エラー検出の結果）
  okJson = JSON.parse(e.stdout || '{}');
}

const syntax = okJson.syntax || [];
assert.ok(Array.isArray(syntax), 'syntax 配列があるべき');
assert.ok(syntax.some(r => String(r.file).includes('ng.mjs')), '構文エラーを検出できるべき');
// exit 1 で終了するのは「問題発見」の正常動作
assert.ok(threw, '問題があるとき exit code 1 になるべき');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ycheck smoke: PASS');