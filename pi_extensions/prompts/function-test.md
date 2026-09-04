---
description: E2E snowballのunit-test段階。先に通ったE2Eを前提に、無知なfunction-testerへ全意味関数のunit test追加を委譲する
argument-hint: "<target> <testFile> <unitCommand> <e2eEvidence>"
---

E2E snowball の unit-test フェーズを開始する。

1. 直前のE2E通過Evidenceを `e2eEvidence` として function_tester に渡す。E2Eはfunction-testerに再実行させない。
2. 対象ソースを `target`、追記可能なテストファイルを `testFile`、単体テストコマンドを `unitCommand` として明示する。
3. function-tester は `--no-context-files --no-extensions` の別piプロセスで、仕様書・@why・設計・git履歴を読まずに作業する。
4. function-testerは指定テストファイルだけを変更し、全ての意味のあるプロダクト関数を tested / unknown / excluded に分類する。
5. unit test完了後、MAIN/WriterがE2Eを再実行し、unit testではなく実際の利用経路によるE2E-only coverageを確認する。
6. E2E-onlyで未到達の重要な関数・分岐・エラー経路があれば、意味のある利用シナリオをE2Eへ追加する。

この手法ではカバレッジ数字だけを目的にしない。unit testは関数の局所契約、E2Eは外部から見た利用シナリオとシステム接続を保証する。

上記の引数を使って `function_tester` ツールを1回呼び出してください。
- target: `$1`
- testFile: `$2`
- unitCommand: `$3`
- e2eEvidence: `$4`
- 追加の直接依存が必要なら、ソースとテスト実行に必要なファイルだけ `additionalAllowedFiles` に入れてください。
