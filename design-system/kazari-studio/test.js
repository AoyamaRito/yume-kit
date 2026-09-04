// @why: design/PHILOSOPHY.md の自然言語E2E思想に基づき、飾り文字エンジンの全プリセット・縦横組版・SVG/CSS/Unicodeエクスポートの整合性を網羅検証するテストスイート
// @tags: SPEC, TEST, E2E_SNOWBALL, SVG_VALIDATION, TYPOGRAPHY_TEST

import assert from 'node:assert';
import './engine.js';

const KazariEngine = globalThis.KazariEngine;

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

console.log('====================================================');
console.log('🖋️  飾り文字工房 (KazariEngine) 単体・E2Eテスト実行');
console.log('====================================================\n');

// ─────────────────────────────────────────────────────────────
// 1. プリセット完全性テスト
// ─────────────────────────────────────────────────────────────
console.log('◆ 1. プリセット完全性 (8大 Sane Defaults 検証)');

runTest('8大プリセットがすべて定義されていること', () => {
  const expectedPresets = [
    'sumi-seal',
    'gold-brass',
    'indigo-crystal',
    'pop-stroke',
    '3d-emboss',
    'cyber-neon',
    'swiss-minimal',
    'ribbon-banner'
  ];

  expectedPresets.forEach((pid) => {
    const p = KazariEngine.PRESETS[pid];
    assert(p, `プリセット "${pid}" が定義されていること`);
    assert(p.name, `プリセット "${pid}" に名前があること`);
    assert(p.fontFamily, `プリセット "${pid}" に fontFamily があること`);
    assert(p.fill, `プリセット "${pid}" に fill 設定があること`);
  });
});

runTest('resolveOptions がユーザー設定とプリセットを正しくマージすること', () => {
  const resolved = KazariEngine.resolveOptions({
    preset: 'cyber-neon',
    text: 'NEON EDGE',
    fontSize: 90
  });

  assert.strictEqual(resolved.preset, 'cyber-neon');
  assert.strictEqual(resolved.text, 'NEON EDGE');
  assert.strictEqual(resolved.fontSize, 90);
  assert.strictEqual(resolved.glow.enabled, true);
});

// ─────────────────────────────────────────────────────────────
// 2. 日本語組版・縦書き約物変換テスト
// ─────────────────────────────────────────────────────────────
console.log('\n◆ 2. 日本語組版・約物変換');

runTest('縦書き時に長音符や括弧が縦グリフに自動変換されること', () => {
  const text = '「スーパー・ショット」！';
  const transformed = KazariEngine.transformGlyphsForVertical(text);

  const bracketOpen = transformed.find((g) => g.original === '「');
  const dash = transformed.find((g) => g.original === 'ー');
  const bracketClose = transformed.find((g) => g.original === '」');
  const smallTsu = transformed.find((g) => g.original === 'ッ');

  assert.strictEqual(bracketOpen.glyph, '﹁');
  assert.strictEqual(dash.glyph, '丨');
  assert.strictEqual(bracketClose.glyph, '﹂');
  assert.strictEqual(smallTsu.isSmall, true);
});

// ─────────────────────────────────────────────────────────────
// 3. レイアウトメトリクス計算テスト
// ─────────────────────────────────────────────────────────────
console.log('\n◆ 3. レイアウトメトリクス計算');

runTest('横書きレイアウトで幅と高さが正しく計算されること', () => {
  const mockCtx = {
    save: () => {},
    restore: () => {},
    font: '',
    measureText: (str) => ({ width: str.length * 72 * 0.85 })
  };

  const opts = KazariEngine.resolveOptions({
    text: '天衣無縫',
    direction: 'horizontal',
    fontSize: 72,
    ruby: 'てんいむほう',
    subText: 'MASTER CRAFT'
  });

  const layout = KazariEngine.measureLayout(mockCtx, opts, 1);
  assert(layout.totalWidth > 0, 'totalWidth が正の値であること');
  assert(layout.totalHeight > 0, 'totalHeight が正の値であること');
  assert.strictEqual(layout.isVertical, false);
});

runTest('縦書きレイアウトで幅と高さが正しく計算されること', () => {
  const mockCtx = {
    save: () => {},
    restore: () => {},
    font: '',
    measureText: (str) => ({ width: str.length * 72 * 0.85 })
  };

  const opts = KazariEngine.resolveOptions({
    text: '天衣無縫',
    direction: 'vertical',
    fontSize: 72,
    ruby: 'てんいむほう'
  });

  const layout = KazariEngine.measureLayout(mockCtx, opts, 1);
  assert(layout.totalWidth > 0, 'totalWidth が正の値であること');
  assert(layout.totalHeight > 0, 'totalHeight が正の値であること');
  assert.strictEqual(layout.isVertical, true);
});

// ─────────────────────────────────────────────────────────────
// 4. ベクター SVG 生成テスト
// ─────────────────────────────────────────────────────────────
console.log('\n◆ 4. ベクター SVG 生成');

runTest('ベクター SVG が完全な XML 構文として出力されること', () => {
  const svg = KazariEngine.generateSVG({
    text: '金剛不壊',
    preset: 'gold-brass',
    ruby: 'こんごうふえ',
    subText: 'UNBREAKABLE'
  });

  assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'SVG ルート要素があること');
  assert(svg.includes('金剛不壊'), 'メインテキストが含まれていること');
  assert(svg.includes('こんごうふえ'), 'ルビが含まれていること');
  assert(svg.includes('UNBREAKABLE'), 'サブテキストが含まれていること');
  assert(svg.includes('<linearGradient'), 'グラデーション定義が含まれていること');
  assert(svg.endsWith('</svg>'), '閉じタグがあること');
});

runTest('特殊文字が SVG 内で正しく XML エスケープされること', () => {
  const svg = KazariEngine.generateSVG({
    text: 'A < B & C > D',
    preset: 'swiss-minimal'
  });

  assert(svg.includes('A &lt; B &amp; C &gt; D'), '特殊文字がエスケープされていること');
  assert(!svg.includes('A < B'), '未エスケープの < が含まれていないこと');
});

// ─────────────────────────────────────────────────────────────
// 5. CSS & Unicode 装飾生成テスト
// ─────────────────────────────────────────────────────────────
console.log('\n◆ 5. CSS & Unicode 装飾生成');

runTest('Web用 CSS スニペットが正しく出力されること', () => {
  const css = KazariEngine.generateCSS({
    text: 'CYBER',
    preset: 'cyber-neon',
    fontSize: 80
  });

  assert(css.includes('.kazari-title'), 'クラス名が定義されていること');
  assert(css.includes('font-size: 80px;'), 'フォントサイズが反映されていること');
  assert(css.includes('text-shadow:'), 'グローまたはシャドウが反映されていること');
});

runTest('Unicode 装飾テキストが生成されること', () => {
  const text = KazariEngine.generateUnicodeFancy('EPISODE 1', 'bold-serif');
  assert(text.includes('𝐄𝐏𝐈𝐒𝐎𝐃𝐄 𝟏'), '太字セリフUnicode文字に変換されていること');
  assert(text.includes('┏━━━━━━━━━━━━━━━━━━━┓'), '装飾罫線が付与されていること');
});

console.log('\n====================================================');
if (failCount === 0) {
  console.log(`🎉 全 ${passCount} 件のテストに合格しました！ (ALL PASS)`);
  process.exit(0);
} else {
  console.error(`⚠️ ${failCount} 件のテストが失敗しました。`);
  process.exit(1);
}
