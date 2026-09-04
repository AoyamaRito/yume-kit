// layout smoke test — 最小 spec → HTML を生成できるか
// @why: [2026-09-06] ベンチ環境で layout が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, layout
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'cli.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-e2e-'));

// 最小レイアウト spec
const spec = {
  width: 800,
  height: 600,
  layers: [
    { type: 'text', text: 'テスト見出し', x: 10, y: 10, w: 300, h: 40, fontSize: 24 },
  ],
};
const jsonPath = path.join(tmp, 'spec.json');
fs.writeFileSync(jsonPath, JSON.stringify(spec));
const outPath = path.join(tmp, 'out.html');

execFileSync(process.execPath, [CLI, jsonPath, '-o', outPath], { encoding: 'utf8' });
assert.ok(fs.existsSync(outPath), 'HTML が生成されるべき');
const html = fs.readFileSync(outPath, 'utf8');
assert.ok(html.includes('テスト見出し'), 'レイヤー内容が含まれるべき');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('layout smoke: PASS');