---
name: kantoku-watch
description: "中間判定用 AI judge。スクリプト内の watch(name, value) で REAL_* 状態を観測して JSON レポートに集約し、OpenRouter 経由の DeepSeek に「proceed/refine/halt」を判定させる。E2E 後に人間の代わりに続行可否を仰ぐ用途。コマンド: node bin/kantoku.js run <file.js>（観測）、node lib/arbitrate.mjs <report.json> <question>（判定）。"
---

// @why: [2026-09-04] kantoku-v5 の観測層 + haiku_plus の判定ループを、pi_root 全体の provider（OpenRouter）で一つに統合し、pi スキルとして公開する。人間セッションでも LLM セッションでも「実行→観測→判定」の中間ゲートを同じコマンドで呼べるようにする。
// @tags: SPEC

# kantoku-watch — 中間判定 AI judge

「見る（watch）」と「判断する（arbitrate）」の二段。E2E や重要な工程の後、人間を待たずに続行可否を AI に問うための最小ゲート。

## 使い方

```bash
cd yume-kit/tools/kantoku

# 1) 観測：対象スクリプトを実行し、watch した REAL_* 状態を JSON レポート化
node bin/kantoku.js run example/real-watch-and-arbitrate.js > report.json

# 2) 判定：レポートを OpenRouter 経由の DeepSeek に渡し、verdict を得る
node lib/arbitrate.mjs report.json "この状態で続行してよい？"
```

判定の結果は 3 値のみ: `proceed`（続行）/ `refine`（修正して？）/ `halt`（停止）。

## 対象スクリプトの書き方

```js
import { watch } from '<...>/runtime/watch.js';
export default function run() {
  const REAL_state = watch('REAL_state', { x: 0 }); // REAL_* のみ観測対象
  REAL_state.set({ x: 1 }, 'inc');                   // 変更・代入を記録
}
```

## 設定（.env / 環境変数）

- `OPENROUTER_API_KEY` — OpenRouter のキー。無い場合は `.env` を自動探索（`lib/env.mjs` の候補順）。
- `KANTOKU_MODEL` — 判定モデル。既定 `deepseek/deepseek-v4-flash-0731`。

## pi セッション内での呼び出し

`/skill:kantoku-watch` でこの SKILL を読み、`node bin/kantoku.js run ...` + `node lib/arbitrate.mjs ...` を実行する。判定結果はヒント（矯正ではない）。最終判断は人間が上書きできる。