// image-compose smoke test — 最小シーン → PNG を生成できるか
// @why: [2026-09-06] ベンチ環境で image-compose が動くことの保証（依存ゼロ・スモーク）
// @tags: SPEC, e2e, image-compose
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'cli.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imgc-e2e-'));

// 最小シーン（単色背景 + レイヤー1枚）
const scene = {
  canvas: { w: 64, h: 64, bg: '#3366ff' },
  layers: [
    { type: 'rect', x: 4, y: 4, w: 16, h: 16, fill: '#ffffff' },
  ],
};
const jsonPath = path.join(tmp, 'scene.json');
fs.writeFileSync(jsonPath, JSON.stringify(scene));
const outPath = path.join(tmp, 'out.png');

try {
  execFileSync(process.execPath, [CLI, jsonPath, '-o', outPath, '--skip-html'], { encoding: 'utf8' });
  assert.ok(fs.existsSync(outPath), 'PNG が生成されるべき');
  assert.ok(fs.statSync(outPath).size > 0, 'PNG が空でないべき');
} catch (e) {
  // pngjs 不在などで落ちる場合は、その旨を明示して fail にする
  assert.fail(`image-compose が失敗: ${e.stderr || e.message}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('image-compose smoke: PASS');