/**
 * constraint-template.js
 *
 * yume-min の「制約関数による状態（制約の物質化）の導出」パターンの
 * 動く典型的なテンプレート。
 *
 * // @why: [2026-08-27] yume-lite 退格（正本を yume-min に一元化）に伴い移植。旧版は worktrees/yume-lite-retired-2026-08-27/ に保存済み。
 * // @tags: SPEC
 *
 * 目的:
 * - if-else の山を「全パターンの物質化 + 1つの derive 関数」に置き換える
 * - LLM が「世界を全部見てから制約で絞る」思考を直接書けるようにする
 * - 状態を「遷移」ではなく「制約の出力」として正確に導出する
 *
 * このファイルは yume-min の core からは独立しています。
 * core.js を読むときにこの仕組みを同時に覚える必要がないようにするためです。
 *
 * 使い方:
 *   - このファイル全体をコピーしてプロジェクトに貼る
 *   - または import { constraintBlock, evalConstraint } from './constraint-template.js'
 *   - 必要ならさらに洗練した版（文字列化derive、矛盾検知など）を自前で作る
 *
 * 典型的な使いどころ:
 *   - 価格/プラン/フラグの組み合わせで最終値を出す
 *   - バリアント生成（size × kind → 物理パラメータ）
 *   - ポリシー/ルール（wind × size → settleProb など）
 *   - 入力から次の状態を一発で特定して commit するループ
 */

import { domainTag, DOMAINS } from './core.js';

export function constraintBlock({ id, axes, values, derive = c => c }) {
  return { id, type: 'constraint', axes, values, derive };
}

export function evalConstraint(cb, filter = {}) {
  const keys = Object.keys(cb.values);
  const vals = keys.map(k => cb.values[k]);

  const cartesian = (arrs) =>
    arrs.reduce((acc, arr) =>
      acc.flatMap(o => arr.map(v => ({ ...o, [keys[arrs.indexOf(arr)]]: v }))), [{}]);

  return cartesian(vals)
    .map(cb.derive)
    .filter(r => Object.entries(filter).every(([k, v]) => r[k] === v));
}

// ============================================================
// 実行例（このファイルを直接 node で実行すると見られます）
// ============================================================

if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  console.log('=== Constraint Folding Template Demo ===\n');

  // 例1: 基本的な料金プラン（if-elseの山を1つの制約に）
  const feeLogic = constraintBlock({
    id: 'fee:plan',
    axes: ['fee', 'plan'],
    values: {
      fee: [100, 300, 700],
      plan: ['basic', 'pro']
    },
    derive: (c) => ({
      ...c,
      effective: c.fee * (c.plan === 'pro' ? 0.8 : 1),
      label: domainTag('text', `${c.plan}-${c.fee}`)
    })
  });

  console.log('全パターン:');
  console.log(evalConstraint(feeLogic));

  console.log('\nfee=700 のときだけ:');
  console.log(evalConstraint(feeLogic, { fee: 700 }));

  // 例2: 雪の物理パラメータ（実際のsnow-3d系で使われているパターンに近い）
  // size × kind の組み合わせで、複数の物理量を一気に導出
  const flakeTypes = constraintBlock({
    id: 'snow:flake-types',
    axes: ['size', 'kind'],
    values: {
      size: ['small', 'medium', 'large'],
      kind: ['light', 'heavy']
    },
    derive: (c) => ({
      ...c,
      radius:   { small: 0.35, medium: 0.55, large: 0.85 }[c.size],
      weight:   c.kind === 'heavy' ? 0.70 : 0.35,
      swayAmp:  c.kind === 'heavy' ? 0.40 : 1.20,
      // domain tag で導出結果も自己記述的に
      tint:     domainTag('color', c.kind === 'heavy' ? 0xbcd4ff : 0xffffff)
    })
  });

  console.log('\n=== フレークバリエーション（全パターン物質化） ===');
  const profiles = evalConstraint(flakeTypes);
  console.log(profiles);

  console.log('\nsize=large のとき:');
  console.log(evalConstraint(flakeTypes, { size: 'large' }));

  // 例3: 実行ループ風の使い方（入力 → 制約で状態を一発特定 → commit のイメージ）
  console.log('\n=== 実行モデル風の流れ（疑似） ===');
  console.log('input (current axes) → evalConstraint で next state を一発取得 → Block に commit');

  const policy = constraintBlock({
    id: 'weather:settling',
    axes: ['wind', 'size'],
    values: {
      wind: [0, 0.5, 1.5, 3.0],
      size: ['small', 'large']
    },
    derive: (c) => {
      const prob = Math.max(0.2, 0.9 - c.wind * 0.2 + (c.size === 'large' ? 0.15 : 0));
      return {
        ...c,
        settleProb: domainTag(DOMAINS.RATIO, Math.round(prob * 100) / 100),
        canSettle: prob > 0.5
      };
    }
  });

  const currentInput = { wind: 1.5, size: 'large' };
  const nextState = evalConstraint(policy, currentInput)[0];
  console.log('入力:', currentInput);
  console.log('導出された状態:', nextState);

  console.log('\nこのテンプレートをコピーして、プロジェクトの状態導出ロジックに使ってください。');
  console.log('core.js には入れないことで、Virtual Heavy 編集の基本モデルをシンプルに保っています。');
}
