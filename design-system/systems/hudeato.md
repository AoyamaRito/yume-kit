# hudeato UI（縦書き執筆）

- **ソース**: `../../hudeato/index.html`
- **計画**: `../../00_HQ_PLAN-hudeato-ui.md`
- **トークン CSS**: [`../tokens/hudeato.css`](../tokens/hudeato.css)
- **用途**: 縦書き IME / 執筆ツール UI

## 現状トークン（index.html より）

| トークン | 値 |
|----------|-----|
| --ink | `#15181f` |
| --navy | `#1e2c4d` |
| --sub | `#5c6675` |
| --line | `#e4e7ee` |
| --accent | `#3b5bf5` |
| --accent-d | `#2c46d6` |
| --soft | `#f5f6fb` |

## V3 目標パレット（HQ 計画）

| 名前 | 値 | 用途 |
|------|-----|------|
| washi-cream | `#faf8f5` | 背景 |
| ink-black | `#1c1d1f` | 文字 |
| urushi-red | `#ab3b2c` | アクセント |
| border-beige | `#e6dfd3` | 枠線 |

フォント目標: Noto Serif JP（本文）+ Inter（UI）

## 原則（計画）

- 和紙・墨・本漆の和モダン
- グラスモーフィズムは候補 UI（変換候補など）に限定
- 縦書き時はホイールを横スクロールにマップ
