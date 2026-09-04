# ガイドライン: 複雑な条件分岐をプロンプトに記述する

AI の推論コストを最小化するため、特に複雑な無条件分岐は直接コードとして追うのではなく、システムプロンプトに構造化されたロジックとして注入することが推奨されます。これにより、AI は全体的な制約充足問題として捉え、尤度ベースで最適な決定を下すことができます。

## 記述形式

以下のいずれかの形式でロジックを記述してください。AI はこれらの形式を推論ガイドラインとして解釈します。

1.  **擬似コード (Python/JavaScript風)**:
    ```python
    def determine_action(context, constraints):
        if context.is_critical_path:
            if constraints.has_security_risk:
                return "ACTION_REQUEST_REVIEW"
            elif constraints.performance_impact > 0.5:
                return "ACTION_PERFORM_LOAD_TEST"
            else:
                return "ACTION_DEPLOY_CANARY"
        elif context.is_bugfix:
            if constraints.is_urgent:
                return "ACTION_APPLY_HOTFIX_AUTOMATED"
            else:
                return "ACTION_SCHEDULE_PATCH"
        else:
            return "ACTION_STANDARD_PROCESS"
    ```

2.  **構造化データ (YAML/JSON)**:
    ```yaml
    decision_flow:
      type: sequential_evaluation
      steps:
        - condition: context.is_critical_path
          true_action: # ネストされた条件やアクション
            - condition: constraints.has_security_risk
              true_action: ACTION_REQUEST_REVIEW
            - condition: constraints.performance_impact > 0.5
              true_action: ACTION_PERFORM_LOAD_TEST
            else_action: ACTION_DEPLOY_CANARY
        - condition: context.is_bugfix
          true_action:
            - condition: constraints.is_urgent
              true_action: ACTION_APPLY_HOTFIX_AUTOMATED
            else_action: ACTION_SCHEDULE_PATCH
        - else_action: ACTION_STANDARD_PROCESS
    ```

## 活用方法

*   `read_prompts.mjs` を利用して、必要な条件分岐ロジックを読み込み、推論の参考にしてください。
*   システムプロンプトには、これらのロジックに従うよう明確に指示します（例: 「デプロイメントの決定には `decision_flow_deployment` プロンプト内のロジックを厳密に適用せよ」）。
*   複雑な判断が必要な場合、`--append-system-prompt` を使って関連する条件分岐プロンプトを一時的に注入することを検討してください（ただし読み飛ばしを避けるため、必要なものに限定）。

## 思考の圧縮と尤度ベースの決定

AI はこれらの構造化されたロジックを、逐次的な IF-ELSE 評価ではなく、全体的な制約の集合として捉えます。各パスの尤度（確からしさ）を評価し、最も制約を満たす確率の高い行動を直接導き出すことで、推論ステップを圧縮し、効率的な解決を目指します。