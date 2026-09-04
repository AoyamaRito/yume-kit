# ui-graph — Web UI ロジカルグラフ抽出 & 異常検知ツール

// @why: AIおよび開発者がWeb UIの構造（包含・スタック・遮蔽・論理接続）を直接透視し、はみ出しやクリック遮蔽などのバグを即時検出・1発修正できるようにする
// @tags: SPEC

## 代替候補だった yume-para（廃止・Delete What, Keep Why）

// @why: 以前、UIの複数案(A/B/C/D)を gemini サブエージェントに並列生成させ、スクショを4分割で並べて人間が目視比較する `yume-para` を試作した。実機テストの結果、4案はどれも「それっぽい」程度で実質的な差が出ず、人間の見る/判断するコストが増えるだけで見返りが小さく、ユーザー判断で廃止した。UIの品質保証は「目で比べる」より「機械的に原因を透視する」方が本質的で、本ツール(ui-graph)に一本化する。
// @tags: SPEC

ブラウザ内部でDOM/CSS/レイアウト/重なり/A11yを走査し、**「UIの物理・論理グラフ」** を自動生成してレイアウト破綻やインタラクション遮蔽を検知するCLIツール。

## なぜ作ったか（Clearify思想）

1. **ピクセルではなく原因を透視**: 画像を見るだけでは「なぜ崩れているか（CSS）」の特定に推測が必要だが、ロジカルグラフなら「どの親から何pxはみ出しているか」「どの要素がボタンを遮蔽しているか」を1撃で特定できる。
2. **トークン90%削減**: 冗長なHTMLタグを圧縮し、本質的なノードとエッジ（包含・重なり・論理接続）だけをターミナルに表示。
3. **機械的品質保証（Evidence over Claims）**: `exit 0` / `exit 1` によるCI・テスト自動化に対応。

## 使い方

```bash
cd ai-tools/ui-graph

# 1. ターミナルで構造と異常を1画面で見る（AIが読むのに最適）
node ui-graph.mjs tree <url or file.html>

# 2. 異常レポートだけを簡潔に出力（合否判定）
node ui-graph.mjs scan <url or file.html>

# 3. Mermaidグラフ形式で出力
node ui-graph.mjs mermaid <url or file.html>

# 4. 完全なJSONデータを出力
node ui-graph.mjs json <url or file.html>
```

### オプション

- `--mobile`: 390x844 (モバイルビューポート) で検証
- `--width <px>` / `--height <px>`: 任意の画面サイズ
- `--wait <ms>`: ページ読み込み後の追加待機時間 (既定: 300ms)

## 検知できる異常（Anomaly List）

| コード | 重大度 | 内容 |
|---|---|---|
| `OVERFLOW_LEAK` | 🚨 ERROR | 親要素の枠から意図せずハミ出ている（はみ出しpx数を算出） |
| `INTERACTION_OCCLUDED` | 🚨 ERROR | ボタンやリンクが別レイヤーの要素（透明div等）に覆い被さられてクリック不能 |
| `TINY_TAP_TARGET` | ⚠️ WARN | インタラクティブ要素のタップ領域が小さすぎる (< 24px) |
| `ZERO_BOX_WITH_CONTENT` | ⚠️ WARN | 幅または高さが 0px なのに中身（テキスト/子要素）が存在する縮退バグ |
| `POINTER_EVENTS_DISABLED` | ⚠️ WARN | インタラクティブ要素に `pointer-events: none` が指定され操作不能 |

## テスト実行

```bash
node test.mjs
```
