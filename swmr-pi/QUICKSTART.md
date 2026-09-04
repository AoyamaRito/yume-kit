# QUICKSTART — SWMR を今日から使う（最小手順）

> 思想: 単発修正に台帳は不要（「聞いて→直接やる」）。**台帳は並列機会・長時間自走・レビュー・E2E snowballに使う**。function-testerはE2E後のunit test追加に使う。

## 1. 要件を台帳に残す

```bash
cp swmr-pi/REQS.md ./MYPROJECT_REQS.md   # 初回だけ
```

ヒアリングのたびに REQ を1つ書く（議事録形式）:

```
## REQ-xxx <タイトル>
- ヒアリング（原文）: 「...」 (日付, 人間)
- 校正（AI 解釈）: 仮定: [...] / 不明点: [...] / 矛盾: [...]
- 確認: 人間の承認 / 修正 (日付)
- 反映: DESIGN_PACKET → コード（@why に結論を内蔵）
```

**次に進む条件**: 「校正」欄が人間に合意されるまで。合意前は設計・実装しない。

## 2. 調査は read-only ツールで並列に

同一メッセージで複数呼ぶ（= 並列 Reader）:
- 外部: `web_search` / `web_fetch`
- 内部: `yspec` / `yhist` / `read`
- 万能: `bash`（read-only コマンドのみ）

## 3. 実装する

- 軽量（今）: セッション内で直接。単発修正は台帳なしで良い
- 重装（将来・任意）: `dev` エージェントにパケットを渡して直列1体で

## 4. E2E snowball: function-tester

E2Eが通った後、対象ソースとテスト入口を決めて `function_tester` を1体だけ起動します。function-testerは仕様・@why・設計・git履歴を読まず、対象の意味のある関数を `tested / unknown / excluded` に分類し、指定テストファイルだけへunit testを追加します。

```text
E2E通過
  → function-tester（unit test追加・E2Eは実行しない）
  → 親MAINがunit testを実行
  → 親MAINがE2Eを再実行
  → E2E-only coverageの未到達経路へE2Eを追加
```

piセッションでは `/function-test <target> <testFile> <unitCommand> <e2eEvidence>` を使います。E2E Evidenceは「コマンドと実測結果」を渡し、function-testerにE2Eを再実行させません。function-tester終了後、親ラッパーが同じunitCommandを実行し、そのstdout/stderr/exitCodeを報告へ付加します。

## 5. レビュー（先入観なし・他モデル）

```bash
# 1) コードレビュー（特定視点からコードを検証）
pi -p --model openrouter/anthropic/claude-haiku-latest --no-context-files --no-session \
   --prompt-template swmr-pi/prompts/swmr-review.md "セキュリティ src/"

# 2) 体制全体の評価（別モデル・文脈ゼロ）
pi -p --model openrouter/anthropic/claude-haiku-latest --no-context-files --no-session \
   --prompt-template swmr-pi/prompts/review-system.md "実用性で評価せよ"
```

※セッション内では `/swmr-review セキュリティ` または `/review-system 実用性` でも実行可能。真の文脈ゼロは上記別プロセスで実行。

## 6. 思い出し線

- 台帳 = 整理した議事録。思考ログは捨てる。仮定/不明点/矛盾を明示
- コードは並列化しない。**情報だけ並列化**する
- Reader に write を与えない
- 単発は直接やる。**並列機会か長時間自走の時だけ台帳+レビュー**