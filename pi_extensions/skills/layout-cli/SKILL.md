---
name: layout-cli
description: AI向けの縦書き・横書きレイヤーレイアウト設計CLI。文字詰め・割注・衝突検知・自動修正を実行する
---

# layout-cli — AI向けレイヤーレイアウト設計CLI

縦書き/横書き混在、ルビ、割注、文字詰め（カーニング）、矩形内文字配置、衝突検知・自動修正を行うレイアウトエンジン。

## 基本コマンド

```bash
# レイアウト検証（衝突・はみ出しチェック）
node yume-kit/tools/layout/cli.js --check <spec.json>

# レンダリング（HTML/PNG生成）
node yume-kit/tools/layout/cli.js <spec.json> -o out.png
```
