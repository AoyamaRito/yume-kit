---
name: ai-tools
description: 2Dアセット生成(asset-gen)、3D地形解析(ascii-3d)、Web画面検証(webqa)、UIロジカルグラフ検証(ui-graph)、画像定性評価(vision-qa)を実行する道具箱
---

// @why: [2026-09-04] pi packages（~/.pi/agent/settings.json）登録により skill 化。コマンド例を実体に同期（webqa は webqa.mjs 単一エントリのサブコマンド構成へ、vision-qa は vision-qa.mjs へ。旧記述の capture.mjs/diff.mjs/qa.mjs は実体なし）。実行は ai-tools ディレクトリ（yume-kit/ai-tools/）を起点にする。
// @tags: SPEC

# ai-tools — AIエージェント運用ツール集

AIエージェントが「見えないものを見る」・「必要なアセットを作る」ための専用ツール群。

> 実行例は `cd yume-kit/ai-tools/` を起点に書いてある。必要に応じて OPENROUTER_API_KEY 等を .env に設定する（各フォルダの README / AI_GUIDE に詳細）。

## 収録ツール

### 1. asset-gen（fal.ai 2Dイラスト・ゲームアセット生成）
fal.ai (Recraft v3, Flux) を叩き、SVGベクターアイコン、ドット絵、立ち絵、背景などを生成する。
```bash
node asset-gen/asset-gen.mjs "magic blue potion bottle" --preset vector-icon --out ./potion.svg
node asset-gen/asset-gen.mjs "fire dragon" --preset pixel-art --out ./dragon.png
node asset-gen/asset-gen.mjs "knight girl" --preset anime-char --out ./knight.png
```

### 2. ascii-3d（3D地形・プロシージャル生成の文字列検証）
アプリと同じ生成ロジックをNodeで再現し、文字列で直描きして検証する。
```bash
node ascii-3d/render.mjs top --seed 42       # 俯視図
node ascii-3d/render.mjs verify --seed 42    # 検証
```

### 3. ui-graph（Web UI ロジカルグラフ・遮蔽・はみ出し自動検知）
ブラウザ内部からロジカルグラフを抽出し、UIバグを即時検出する。
```bash
node ui-graph/ui-graph.mjs scan <url or file.html>     # 異常サマリー（CI合否）
node ui-graph/ui-graph.mjs tree <url or file.html>     # 構造+異常ツリー
node ui-graph/ui-graph.mjs mermaid <url or file.html>  # グラフ出力
```
※ pi セッション内なら同機能は yui ツール（yume-spec）で呼べる。ui-graph は外部シェル・CI向け。
※ extractor 実体は ui/extractor.js（yume-kit/ui/）と共有（ai-tools/ui-graph/extractor.js は薄い re-export）。
  // @why: [2026-09-06] extractor.js の 2 コピー分岐（ai-tools 旧版 / yume-spec 進化版）を yume-spec 正本に一本化。
  //       進化版（SVG誤検出防止・<option>除外・非表示祖先検出）が正本であるため、ai-tools 側は import 互換の re-export。
  // @tags: SPEC

### 4. webqa（ヘッドレスChrome による画面検査: スナップショット・解析・ascii化）
```bash
node webqa/webqa.mjs snap <url> <out.png> [--mobile]   # スクショ
node webqa/webqa.mjs analyze <img.png>                 # 穴/スリット/主要色/対比度
node webqa/webqa.mjs ascii <img.png>                  # 画像を文字列化（目の代わり）
node webqa/webqa.mjs qa <url>                        # snap→analyze→ascii 一括
```
※ 依存（playwright-core / pngjs）は yume-kit ルートの node_modules で解決（yume-kit 一体運用）。
  // @why: [2026-09-06] webqa が 8.3MB の playwright-core 1.55.0 を内蔵していたのを、ルートの playwright-core ^1.62 に一本化（9.1MB → 16KB）。
  //       ルート package.json の dependencies に pngjs を追加済み。webqa 単体で使う場合は `cd webqa && npm install`。
  // @tags: SPEC

### 5. vision-qa（マルチモーダルAIを使った画像定性評価）
```bash
node vision-qa/vision-qa.mjs shot.png "このUIで不整合を3点挙げて"
```