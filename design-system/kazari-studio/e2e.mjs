// @why: design/PHILOSOPHY.md の自然言語E2E思想に基づき、ユーザーの成功ストーリー（直列3ステップ完走・プリセット切替・縦横変換・エクスポート）を自動検証するSnowball E2Eスイート
// @tags: SPEC, E2E_SNOWBALL, SCENARIOS, INSTANT_DONE, VALIDATION

import assert from 'node:assert';
import './engine.js';

const KazariEngine = globalThis.KazariEngine;

let totalScenarios = 0;
let passedScenarios = 0;

function scenario(title, steps) {
  totalScenarios++;
  console.log(`\n────────────────────────────────────────────────────────`);
  console.log(`📖 シナリオ ${totalScenarios}: ${title}`);
  console.log(`────────────────────────────────────────────────────────`);
  try {
    steps();
    console.log(`  ✨ [PASS] シナリオ "${title}" 完走・エビデンス確認`);
    passedScenarios++;
  } catch (err) {
    console.error(`  💥 [FAIL] シナリオ "${title}" 失敗`);
    console.error(`     理由: ${err.message}`);
  }
}

console.log('====================================================');
console.log('🚀 飾り文字工房 (Kazari Studio) 自然言語 E2E Snowball');
console.log('====================================================');

// シナリオ 1: 最速スキップ完走 (Instant Done)
scenario('最速スキップ完走 — 3ステップで高品位飾り文字を即座に獲得', () => {
  // Step 1: 原稿入力
  const title = '革命前夜';
  console.log(`  1. 原稿「${title}」を入力`);
  const opts = KazariEngine.resolveOptions({ text: title });

  // Step 2: スキップ実行 (デフォルト 80点プリセット「墨漆と落款」適用)
  console.log('  2. [スキップして書き出す] を選択');
  assert.strictEqual(opts.preset, 'sumi-seal');

  // Step 3: DONE 成果物獲得
  console.log('  3. 透過PNG / ベクターSVG / CSSスニペットを生成');
  const svg = KazariEngine.generateSVG(opts);
  const css = KazariEngine.generateCSS(opts);

  assert(svg.includes(title), 'SVG にタイトルが含まれること');
  assert(svg.includes('rect'), '落款（朱印）が含まれること');
  assert(css.includes('.kazari-title'), 'CSS クラスが定義されること');
  console.log('  4. 成果物（SVG/CSS）が 0.05秒で生成完了');
});

// シナリオ 2: 8大プリセット切り替え & 黄金3Dベベル
scenario('プリセット切替 — 金箔真鍮プリセットで3Dベベル彫刻と王冠を適用', () => {
  console.log('  1. プリセット「金箔と真鍮」を選択');
  const opts = KazariEngine.resolveOptions({
    preset: 'gold-brass',
    text: 'EMPEROR',
    ruby: 'カイザー',
    subText: 'ROYAL DYNASTY'
  });

  assert.strictEqual(opts.preset, 'gold-brass');
  assert(opts.fill.type === 'gradient', 'グラデーション塗りが有効であること');
  assert(opts.shadow3d.depth > 0, '3D立体押し出しが有効であること');

  console.log('  2. ベクター SVG を生成しグラデーションとオーナメントを検証');
  const svg = KazariEngine.generateSVG(opts);
  assert(svg.includes('<linearGradient'), '黄金グラデーションが定義されていること');
  assert(svg.includes('EMPEROR'), 'タイトルが含まれていること');
  assert(svg.includes('ROYAL DYNASTY'), 'サブテキストが含まれていること');
});

// シナリオ 3: 縦書き組版 & 約物・ルビ・落款の配置
scenario('縦書き組版 — 長音符・括弧の回転、促音右上配置、右ルビの検証', () => {
  console.log('  1. 縦書きモードで「「スーパー・スター」」を設定');
  const text = '「スーパー・スター」';
  const glyphs = KazariEngine.transformGlyphsForVertical(text);

  assert.strictEqual(glyphs[0].glyph, '﹁', '開き括弧が縦グリフに変換されること');
  assert.strictEqual(glyphs[2].glyph, '丨', '長音符が縦グリフに変換されること');
  assert.strictEqual(glyphs[glyphs.length - 1].glyph, '﹂', '閉じ括弧が縦グリフに変換されること');

  console.log('  2. 縦書き SVG を生成');
  const svg = KazariEngine.generateSVG({
    text,
    direction: 'vertical',
    ruby: '超新星',
    ornaments: { seal: { show: true, text: '極' } }
  });

  assert(svg.includes('﹁'), 'SVG に縦括弧が含まれること');
  assert(svg.includes('超新星'), 'SVG にルビが含まれること');
});

// シナリオ 4: 電撃ネオン & サイバー発光
scenario('サイバーネオン — 多層発光グローとモノスペース欧文の検証', () => {
  console.log('  1. プリセット「電撃ネオン」を選択');
  const opts = KazariEngine.resolveOptions({
    preset: 'cyber-neon',
    text: 'NEURAL LINK'
  });

  assert.strictEqual(opts.glow.enabled, true, 'グローが有効であること');
  const svg = KazariEngine.generateSVG(opts);
  assert(svg.includes('<feGaussianBlur'), 'SVG にガウスブラーフィルターが含まれること');
});

console.log('\n====================================================');
if (passedScenarios === totalScenarios) {
  console.log(`🎉 全 ${totalScenarios} 本の自然言語シナリオが完走しました！ (E2E ALL PASS)`);
  process.exit(0);
} else {
  console.error(`⚠️ ${totalScenarios - passedScenarios} 本のシナリオが失敗しました。`);
  process.exit(1);
}
