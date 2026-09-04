# kantoku-watch — 中間判定 AI judge（watch + arbitrate）

実行中の REAL_* 状態を観測して JSON レポートに集約し、そのレポートを OpenRouter（DeepSeek）に渡して proceed/refine/halt の 3 値判定を得る。自律開発の「人間の代わりに続行可否を仰ぐ中間ゲート」。

## 何をするか

- **見る（watch）**: 対象スクリプト内の `watch(name, value)` を観測し、JSON レポートに集約（REAL_* のみ対象、不正値・不変を警告）
- **判断する（arbitrate）**: レポートを OpenRouter 経由で DeepSeek に渡し、verdict（`proceed` / `refine` / `halt`）を得る

## 使い方

```bash
# 1) 観測
node yume-kit/tools/kantoku/bin/kantoku.js run example.js > report.json

# 2) 判定（OpenRouter 実通信）
node yume-kit/tools/kantoku/lib/arbitrate.mjs report.json "この状態で続行してよい？"
```

## 実用場面

大規模 E2E・アセット生成バッチなどの長時間ジョブ後、人間を待たず続行可否を AI judge に仰ぐ中間ゲートとして使う（判定は推奨、最終判断は人間が上書可）。