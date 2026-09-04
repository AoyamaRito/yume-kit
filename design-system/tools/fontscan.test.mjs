#!/usr/bin/env node
// tools/fontscan.test.mjs — 合成フォントで fontscan パイプラインを検証する
// @why: [2026-08-28] fontscan が「nameテーブルからのライセンス抽出 → CSS変数/JSON/ライセンス台帳/ハブ生成」
//       を正しく行うことのエビデンス。実フォントに依存せず、テスト専用の最小 sfnt フィクスチャを
//       組み立てて検証する（バイナリはブラウザ実装用ではない・パーサ検証専用）。
// @tags: SPEC, TEST
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { generate } from './fontscan.mjs';

// ================================================================ synthetic fixture builders
function utf16be(s) {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2);
  return b;
}

// OpenType 'name' テーブル（platform=3 Windows / enc=BMP / lang=en-US）
function nameTable(records) {
  const enc = records.map(([id, s]) => [id, utf16be(s)]);
  let cursor = 0;
  const header = Buffer.alloc(6 + enc.length * 12);
  header.writeUInt16BE(0, 0); // format=0
  header.writeUInt16BE(enc.length, 2);
  header.writeUInt16BE(6 + enc.length * 12, 4); // stringOffset
  enc.forEach(([id, str], i) => {
    const o = 6 + i * 12;
    header.writeUInt16BE(3, o);
    header.writeUInt16BE(1, o + 2);
    header.writeUInt16BE(0x409, o + 4);
    header.writeUInt16BE(id, o + 6);
    header.writeUInt16BE(str.length, o + 8);
    header.writeUInt16BE(cursor, o + 10);
    cursor += str.length;
  });
  return Buffer.concat([header, ...enc.map((e) => e[1])]);
}

// 最小 sfnt（name + OS/2 のみ）。magic で TTF(0x00010000) / OTF(0x4F54544F) を切り替え
function buildFont({ family, subfamily, license = '', licenseUrl = '', copyright = '', weight = 400, magic = 0x00010000 }) {
  const name = nameTable([
    [0, copyright],
    [1, family],
    [2, subfamily],
    [4, family + ' ' + subfamily],
    [6, family.replace(/[^A-Za-z0-9]/g, '') + '-' + subfamily],
    [13, license],
    [14, licenseUrl],
  ]);
  const os2 = Buffer.alloc(64);
  os2.writeUInt16BE(4, 0); // version
  os2.writeUInt16BE(weight, 4); // usWeightClass
  const n = 2;
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(magic, 0);
  head.writeUInt16BE(n, 4);
  const dirOff = 12 + n * 16;
  head.write('name', 12, 'latin1');
  head.writeUInt32BE(dirOff, 20);
  head.writeUInt32BE(name.length, 24);
  head.write('OS/2', 28, 'latin1');
  head.writeUInt32BE(dirOff + name.length, 36);
  head.writeUInt32BE(os2.length, 40);
  return Buffer.concat([head, name, os2]);
}

const OFL_TEXT = 'This Font Software is licensed under the SIL Open Font License, Version 1.1.';
const buildT = buildFont; // alias（テスト内の見かけ名）

// ================================================================ test
function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fontscan-'));
  const fontDir = path.join(tmp, 'fonts');
  fs.mkdirSync(fontDir, { recursive: true });

  // 1) OFL ゴシック家族（400/700 の2ウェイト）
  fs.writeFileSync(path.join(fontDir, 'TESTGothicJP-Regular.ttf'),
    buildT({ family: 'TEST Gothic', subfamily: 'Regular', license: OFL_TEXT, licenseUrl: 'https://openfontlicense.org', copyright: '© 2026 Test Author', weight: 400 }));
  fs.writeFileSync(path.join(fontDir, 'TESTGothicJP-Bold.ttf'),
    buildT({ family: 'TEST Gothic', subfamily: 'Bold', license: OFL_TEXT, licenseUrl: 'https://openfontlicense.org', weight: 700 }));
  // 2) 規制あり明朝 → OTF magic
  fs.writeFileSync(path.join(fontDir, 'TESTMincho-Regular.otf'),
    buildT({ family: 'TEST Mincho', subfamily: 'Regular', license: 'Commercial license. All rights reserved.', copyright: 'Test Mincho Foundry', magic: 0x4f54544f }));
  // 3) woff2（中身は参照しない、HTML 上は不可読ではないがメタデータは filename 頼り）
  fs.writeFileSync(path.join(fontDir, 'Mystery-Regular.woff2'), Buffer.concat([Buffer.from([0x77, 0x4f, 0x46, 0x32]), Buffer.alloc(64, 7)]));

  const { pd, outCss, outJson, outLic, outHub } = generate({ root: tmp, fontDir });

  // ---- tokens/fonts.css
  const css = fs.readFileSync(outCss, 'utf8');
  assert.ok(css.includes('@font-face'), 'CSS: @font-face がある');
  assert.ok(css.includes('TEST Gothic'), 'CSS: ファミリー名（name テーブル由来）がある');
  assert.ok(css.includes('font-weight: 700'), 'CSS: Bold 700 がある');
  assert.ok(css.includes('format("truetype")'), 'CSS: ttf の format 補正');
  assert.ok(css.includes('format("opentype")'), 'CSS: otf の format 補正');
  assert.ok(css.includes('--font-sans: "TEST Gothic"'), 'CSS: --font-sans 変数生成（gothic→sans）');
  assert.ok(css.includes('--font-serif: "TEST Mincho"'), 'CSS: --font-serif 変数生成（mincho→serif）');
  assert.ok(css.includes('font-display: swap'), 'CSS: font-display 指定');

  // 2) fonts.json
  const json = JSON.parse(fs.readFileSync(outJson, 'utf8'));
  const fams = json.families;
  assert.equal(fams.length, 3, 'json: 3ファミリー');
  const gothic = fams.find((f) => f.name === 'TEST Gothic');
  assert.ok(gothic, 'json: TEST Gothic がいる');
  assert.deepEqual(gothic.files.map((x) => x.weight).sort(), [400, 700], 'json: ウェイト 400/700 両方が拾える');
  assert.equal(gothic.lic.kind, 'SIL OFL 1.1', 'json: OFL 自動判定');
  assert.equal(gothic.lic.ok, true, 'json: OFL は ✅');
  assert.equal(gothic.licenseUrl, 'https://openfontlicense.org', 'json: ライセンス URL 抽出');
  const mincho = fams.find((f) => f.name === 'TEST Mincho');
  assert.equal(mincho.category, 'serif', 'json: mincho→serif 分類');
  assert.equal(mincho.lic.ok, false, 'json: 規制文言は ⚠️');
  assert.equal(mincho.lic.kind, '規制あり', 'json: 規制あり 判定');
  const mystery = fams.find((f) => f.name === 'Mystery');
  assert.equal(mystery.files[0].format, 'woff2', 'json: woff2 も収録');
  assert.equal(mystery.lic.kind, '要確認', 'json: woff2 メタなし → 要確認');

  // 2b) woff2 のファイル名由来ウェイト抽出
  assert.deepEqual(mystery.files.map((x) => x.weight).sort(), [400], 'json: woff2 ファイル名 Regular→400');

  // 3) LICENSES.md
  const md = fs.readFileSync(outLic, 'utf8');
  assert.ok(md.includes('SIL OFL 1.1'), '台帳: OFL 記載');
  assert.ok(md.includes('✅'), '台帳: ✅ マーク');
  assert.ok(md.includes('規制あり'), '台帳: 規制あり記載');
  assert.ok(md.includes('⚠️'), '台帳: ⚠️ マーク');

  // 4) font-hub.html（自己完結: データ + カード + faces 注入）
  const hub = fs.readFileSync(outHub, 'utf8');
  assert.ok(hub.includes('FONT_DATA = '), 'hub: データ埋め込み');
  assert.ok(hub.includes('TEST Gothic'), 'hub: ファミリーカード表示');
  assert.ok(hub.includes('TEST Mincho'), 'hub: ファミリーカード表示2');
  assert.ok(hub.includes('@font-face'), 'hub: faces 注入あり');
  // フォントブック見本（ひらがな/カタカナ/漢字/数字/アルファベット）が埋め込まれている
  assert.ok(hub.includes('ひらがな'), 'ブック: ひらがな見本');
  assert.ok(hub.includes('カタカナ'), 'ブック: カタカナ見本');
  assert.ok(hub.includes('永字八法'), 'ブック: 漢字見本');
  assert.ok(hub.includes('0 1 2 3 4 5 6 7 8 9'), 'ブック: 数字見本');
  assert.ok(hub.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'ブック: アルファベット見本');
  assert.ok(hub.includes('font-row'), 'ブック: 1行リスト描画ロジック');

  // 5) override（catalog.json）動作
  const fontDir2 = path.join(tmp, 'fonts2');
  fs.mkdirSync(fontDir2, { recursive: true });
  fs.writeFileSync(path.join(fontDir2, 'TESTGothic2-Regular.ttf'),
    buildT({ family: 'TEST Gothic2', subfamily: 'Regular', license: '' }));
  // woff2（メタ無し）でも catalog.json でライセンス・カテゴリ・ウェイトを人手で固定できる
  fs.writeFileSync(path.join(fontDir2, 'TEST Gothic2-Bold.woff2'), Buffer.concat([Buffer.from([0x77, 0x4f, 0x46, 0x32]), Buffer.alloc(32, 9)]));
  fs.writeFileSync(path.join(fontDir2, 'catalog.json'), JSON.stringify({
    'TEST Gothic2': { category: 'display', license: OFL_TEXT, licenseUrl: 'https://example.com/ofl', copyright: 'Test Authors', note: '人手記録' },
  }));
  generate({ root: path.join(tmp, 'out2'), fontDir: fontDir2 });
  const s2 = JSON.parse(fs.readFileSync(path.join(fontDir2, 'fonts.json'), 'utf8')).families;
  assert.equal(s2[0].category, 'display', 'override: catalog.json でカテゴリ固定');
  assert.equal(s2[0].lic.kind, 'SIL OFL 1.1', 'override: catalog.json のライセンスで OFL 判定');
  assert.equal(s2[0].copyright, 'Test Authors', 'override: 著作権の人手記録');
  assert.equal(s2[0].files.find((x) => x.weight === 700).weight, 700, 'override: woff2 ファイル名 Bold→700');

  console.log('✅ fontscan.test — すべて PASS');
  console.log('  - @font-face / CSS変数 / JSON / ライセンス台帳 / 試し打ちハブ を合成フォントで検証済み');
  console.log('  - OFL✅ / 規制あり⚠️ / 不明⚠️ / woff2 / ttf / otf / override(catalog.json) を網羅');
}
main();