// present smoke test — スライド JSON → HTML を生成できるか（PDF なし）
// @why: [2026-09-06] ベンチ環境で present が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, present
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'present.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'present-e2e-'));

const slides = {
  title: 'テストプレゼン',
  slides: [
    { title: 'スライド1', body: '内容1' },
    { title: 'スライド2', body: '内容2' },
  ],
};
const jsonPath = path.join(tmp, 'slides.json');
fs.writeFileSync(jsonPath, JSON.stringify(slides));
const outPath = path.join(tmp, 'out.html');

execFileSync(process.execPath, [CLI, jsonPath, '-o', outPath, '--no-pdf', '--no-check'], { encoding: 'utf8' });
assert.ok(fs.existsSync(outPath), 'HTML が生成されるべき');
const html = fs.readFileSync(outPath, 'utf8');
assert.ok(html.includes('スライド1'), 'スライド内容が含まれるべき');
assert.ok(html.includes('<html') || html.includes('<!doctype'), 'HTML 構造があるべき');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('present smoke: PASS');