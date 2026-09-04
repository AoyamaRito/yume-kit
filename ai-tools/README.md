# ai-tools — エージェント運用ツール集

AIエージェント（自分用）が **「見えないものを見る」ための道具** をまとめたディレクトリ。
このREADMEを読めば、次セッションでも同じ道具をすぐ使える。

## 構成

| ツール | 何をする | いつ使う | 効果（正直な自己評価） |
|---|---|---|---|
| **asset-gen/** | fal.ai API (Recraft v3, Flux) を用いた2Dイラスト・ゲームアセット制作エンジン。**キャラクター同一性・絵柄保持・表情/ポーズパック一括生成・インタラクティブHTMLビューア**完備 | ゲーム素材・UI素材・キャラクター立ち絵・表情差分・Web背景を生成したい時 | 🟢 **大幅強化(2026-08)**。Recraft v3/Fluxによる同一性保持・パック一括生成・HTMLビューア自動出力・全E2E PASS実証済み |
| **ui-graph/** | ブラウザ内部からロジカルグラフ（包含/スタック/遮蔽/A11y）を自動抽出し、はみ出し（overflow）や遮蔽（occlusion）などのUIバグを即時検出 | Web UIのデバッグ・レイアウト検証・CI合否判定時 | 🟢 **新規作成(2026-08)**。4大バグ（はみ出し+202px/透明div遮蔽/極小タップ/ゼロサイズ）の1撃特定をE2E実証済み |
| **ascii-3d/** | 3D地形を文字列で直描き（俯視/透視/断面/影/チャンネル/ムービー/検証）。アプリと同じ生成ロジックをNodeで再現するので**無損失のグラウンドトゥルース** | 地形の構造・統計・バッチQA・パラメータ影響を見たい時 | 🟢 **実証済み**。30シード一括調査で「水量47-55%固定」「ピーク低め」という人間の目視では不可能な範囲を発見 |
| **webqa/** | ヘッドレスChromeでスクショ・`__rpg3d`取得・パリティ検証・ピクセル解析（穴/スリット/色）・画像の文字列化 | アプリの実動作を機械検証する時 | 🟢 **実証済み**。スリット（透け12%）の発見→1/4単位修正につながった。パリティ=完全一致確認済み |
| **vision-qa/** | 画像をマルチモーダルAI（OpenRouter経由）に渡して日本語レポート化 | 「雰囲気・テイスト・崩れ」の定性評価 | 🟡 **未実証**。1回の実走行で「全項目問題なし」の甘い回答。**テイスト判断は人間の目が最終**。Visionモデル特有の誤認リスクあり |
| **monte-carlo-test/** | 実ブラウザでDOMをランダム操作し、パターン抽出→意図生成→コマンド実行で壊れ(遮蔽実測・連続エラー・暴走・インジェクション)を機械探索 | 作ったWeb UIを「LLMの腕前」に依らず機械で通る/通らないを担保したい時。ui-graph(静的)と役割分担 | 🟢 **実証済み(2026-09)**。遮蔽バグ6/6検出(座標クリック)・ドラッグ＆ドロップDragEvent実測・5種操作(random)・決定的再現 |
| **ga4-monitor/** | GA4データの鮮度・ボリューム異常・受信経路を自前で継続監視（zero-dep、cronで定期実行、Slack通知） | GA4にデータが流れてるか・遅延・前日比異常を常時確認したい時 | 🟡 **新規作成(2026-06)**。ロジックはData API+MPの公式仕様ベース。実データで閾値調整が必要 |

シンプルな使い方:

```bash
# asset-gen（2Dイラスト・ゲームアセット生成）
cd ai-tools/asset-gen && node asset-gen.mjs "magic potion" --preset vector-icon --out ./potion.svg
node asset-gen.mjs "fire dragon" --preset pixel-art --out ./dragon.png
node asset-gen.mjs "knight girl" --preset anime-char --out ./knight.png

# ui-graph（Web UIのロジカルグラフ透視・異常検知）
cd ai-tools/ui-graph && node ui-graph.mjs tree <url or file.html>       # 構造+異常を1画面ツリー表示
node ui-graph.mjs scan <url or file.html>                               # 異常サマリー（CI合否判定）
node ui-graph.mjs mermaid <url or file.html>                            # Mermaidグラフ出力

# ascii-3d（依存はインストール済み）
cd ai-tools/ascii-3d && node render.mjs top --seed 42        # 俯視図
node render.mjs verify --seed 42                             # 1/4刻み・穴なしを数値判定(exit 1でNG)
node render.mjs movie --mode orbit --frames 8                # カメラ周回＝文字列ムービー
node render.mjs movie --mode sweep --to 2.0                  # 高低差スイープ
node render.mjs channel --img ../../3d-rpg-map/preview.png --c DOM   # 支配チャンネル(R/G/B)

# webqa（初回のみ npm i）
cd ai-tools/webqa && node webqa.mjs parity <url>             # アプリと再生成が一致するか

# monte-carlo-test（ランダム操作でUIの壊れを探索・playwrightはwebqaと共有）
cd ai-tools/monte-carlo-test && node fuzz.mjs scan <file.html> --seed 42  # 遮蔽/エラーを機械検出
node fuzz.mjs scenario <file.html> --seed 42 --steps 20                 # 意図(シナリオ)生成
node fuzz.mjs replay <scenario.json>                                    # 意図→コマンド実行(座標マウス)

# ga4-monitor（依存不要）
cd ai-tools/ga4-monitor && cp .env.example .env   # 設定を埋める
node ga4-monitor.mjs              # 鮮度/ボリューム/受信経路チェック（cronで定期実行）
node ga4-monitor.mjs --ping       # MPテストヒット送信（受信経路の死活）
node webqa.mjs analyze <img.png>                             # 穴/スリット/色のピクセル解析
node webqa.mjs qa <url>                                      # スクショ→解析→文字列化 一括

# vision-qa（OpenRouterキーは ../deepseek-spawn/.env を自動参照）
cd ai-tools/vision-qa && node vision-qa.mjs shot.png --preset terrain
```

## 設計の要点（忘れないこと）

1. **ascii-3d の地形ロジックは 3d-rpg-map/index.html の唯一下流コピー**。パラメータや生成式をアプリ側で変えたら **必ず `webqa.mjs parity` を実行して一致を確認する**（maxDiff=0必須）。変えたら直す。
2. ピクセル解析の数値（穴%・スリット本数）は**同一バージョンのツール内での相対比較専用**。実装を変えると数値が変わるので、前回と比較する時はツールを変更しないこと。
3. **ライフサイクル（重要）**: 道具は「使われて始めて意味がある」。**次の3回の作業で一度も使われなかったツールは削除する**（AGENTS.mdの『不要なカプセルを作らない』ポリシーに従う）。
4. vision-qa のレポートは**鵜呑み禁止**。指摘があれば webqa のピクセル解析 or ascii-3d の実データで検算してから採用する。

## 連携パターン（わかっている正解）

```
① ascii-3d verify   … 幾何の正しさ（穴・1/4刻み）   ← 数値で判定できる系
② webqa parity      … アプリと再生成の一致           ← グラウンドトゥルース保証
③ webqa analyze     … レンダリング実測（透け・線・色） ← 実画面の機械検算
④ ascii-3d views    … 構造・バッチ統計・パラメータ影響 ← 人間の目視不可能な範囲
⑤ vision-qa / 人間  … テイスト・好み（唯一、機械では確定できない層）
```

①〜④は**機械的に自動化・CI化できる**。⑤だけは人間の目が最終。