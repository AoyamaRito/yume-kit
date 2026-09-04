# swmr-pi — Single Writer / Multiple Readers 運用システム（pi パッケージ）

// @why: AI自走開発における並列化の原則（00_SPEC-swmr.md）に基づき、要件台帳・先入観なしレビュー・function_tester・サブエージェント監視/介入制御（Watchdog/Intercept）を統合した運用システム。
// @tags: SPEC, SWMR, WATCHDOG

AI 自走開発の並列化原則 **「コードは並列化しない。情報だけ並列化する」** を pi.dev 上で実現するパッケージ。

- **文書**: 原則（SPEC.md）・設計書（DESIGN.md）・要件台帳（REQS.md）
- **規約**: 要件台帳（ヒアリング層→校正層→実装層・議事録形式）
- **レビュー**: 視点付き・先入観なしのコード/体制レビュー（他の LLM から評価可能）
- **function-tester**: E2E通過後、文脈を分離したサブエージェントが意味のあるプロダクト関数のunit testを追加する
- **Watchdog & 介入制御**: サブエージェントの無反応・暴走・空回り検知、一時停止（SIGSTOP）、点検（Inspect）、中間報告、再開（SIGCONT/Steer）
- **エージェント定義**: research / inspect / planner / dev / reviewer / function-tester（重装用）

## 導入

```bash
# ローカルパスから
pi install ./swmr-pi

# または git/npm 化した後
pi install git:github.com/USER/swmr-pi@v0.2.0
pi install npm:swmr-pi@0.2.0
```

これで `/review-system`（体制評価）、`/swmr-review`（コードレビュー）、`/function-test`（E2E snowballのunit-test段階）のプロンプトテンプレートが使える。

**今日から使い始める** → [QUICKSTART.md](QUICKSTART.md)（1枚・最小手順）

## インストール状態（既定: 未ロード・必要な時だけ導入）

// @why: [2026-09-04] `pi install` は **恒常ロード** する。しかし pi_root の日常は単一エージェント運用（AGENTS.md「並列は特殊ケースのみ」）で、swmr-pi の extensions（function-tester.ts / subagent-watchdog.ts）は**並列サブエージェント運営時だけ**価値がある。恒常ロードすると ext がツールとして常時見え、ノイズになる（clearify）。よって既定は未ロード、並列・重装の時にだけ一時導入する。
// @tags: SPEC

- **既定**: `pi install` も `.pi/extensions/` 配置も行わない（未ロード）。文書（DESIGN / REQS / QUICKSTART）と prompts は普段から読んでよい。
- **並列・重走の時**: `pi install ./swmr-pi` か、必要な拡張だけ `.pi/extensions/` にコピーして `/reload`。用が済んだら外す。
- **文書の対象**: DESIGN.md の重装（subagent 直列フロー）は「その場で組み立てる」方式なので、この README が恒久ロードされることはない。

## 使い方（この体制の評価をさせる）

他の LLM にこの体制を評価させる最も簡単な方法:

```bash
# 別モデル・別セッション（文脈ゼロ = 先入観なし）で体制全体を評価
pi -p --model <別モデル> --no-context-files --no-session \
   --prompt-template swmr-pi/prompts/review-system.md \
   "実用性と一貫性で評価せよ"
```

または pi セッション内で:
```
/review-system 実用性
/review-system 一貫性
/review-system セキュリティ
```

## コア思想（1分で理解する）

1. **Single Writer** — 設計・実装・修正は 1 体（または直列 1 件ずつ）。コードは共有 mutable state なので並列化しない
2. **Multiple Readers** — 調査（Web/コード/人間）は read-only・相互非衝突なので並列化できる
3. **要件台帳 = 整理した議事録** — 思考ログは捨てる。人間の原文と AI の校正（仮定/不明点/矛盾）を交互に残す
4. **レビューは視点付き・先入観なし** — 作者の意図を知らないからこそ、作者が見落とす問題が見える
5. **E2E snowball** — E2E通過後に無知なfunction-testerがunit testを追加し、MAIN/WriterがE2E-only coverageを増やす

## 構成

```
swmr-pi/
├── package.json      pi パッケージマニフェスト
├── README.md         このファイル
├── SPEC.md           原則（00_SPEC-swmr.md の配布用コピー）
├── DESIGN.md         設計書（軽量 Phase1 運用中 / 重装 未着手）
├── REQS.md           要件台帳（REQ-001 以降、議事録の実例）
├── QUICKSTART.md      今日から使う最小手順（1枚）
├── coverage-diff.mjs  E2E snowball 手順6–7の道具（unit vs E2E の関数単位カバレッジ差分。依存ゼロ）
├── agents/           重装（subagent）用エージェント定義
│   ├── research.md / inspect.md / planner.md / dev.md / reviewer.md
│   └── function-tester.md # E2E snowballのunit-test担当
└── prompts/          プロンプトテンプレート
    ├── review-system.md   # /review-system 体制全体の評価
    ├── swmr-review.md     # /swmr-review コードベースの視点レビュー
    └── function-test.md    # E2E snowballのunit-testフェーズ
```

## E2E snowball: function-testerの位置

E2E snowballは、E2E・unit test・E2E-only coverageを順序づけて累積する手法である。
まずE2Eで外部振る舞いを固定して通し、その後 `function_tester` を仕様・@why・設計書・git履歴なしの別piプロセスで起動する。
function-testerは対象ソースの意味のある関数を `tested / unknown / excluded` に分類し、指定されたテストファイルだけにunit testを追加する。
unit test後はMAIN/WriterがE2Eを再実行し、unit testではなく実際の利用経路で到達したE2E-only coverageを確認する。未到達の重要な経路には意味のあるE2Eシナリオを追加する。

計測は `coverage-diff.mjs` で行う（DESIGN.md §5.1）:

```bash
node swmr-pi/coverage-diff.mjs --unit "node test/core.test.js" --e2e "node e2e.mjs" --source src
# → both / unit-only(E2Eシナリオ追加候補) / e2e-only(function-tester委譲候補) / uncovered の4分類を報告
```

カバレッジ差分の多寡ではブロックしない（ヒントであり矯正ではない）。exit≠0 はテスト自体の失敗のみ。

カバレッジ数値だけを増やす空テスト、現在の実装を正しいと仮定したテスト、既存テストを弱める変更は禁止する。
「全ての関数」とはテストコードのhelperや生成コードではなく、対象プロダクトコードの意味のある関数を指す。契約がソースだけで確定しないものはunknownとして報告する。

## 本プロジェクトの参照

- ワークスペース規約: `AGENTS.md`（「要件台帳」節・「並列化の原則」節を参照）
- 地図: `00_ENTRY.md`（§3 [試行中] SWMR 運用）
- 原則: `00_SPEC-swmr.md`（正本 / SPEC.md はコピー）

## ライセンス

MIT