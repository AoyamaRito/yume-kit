# SRD ドキュメント DS（A3 印刷）

- **ソース例**: `../../SRD/SRD_基本ルール_A3.html`
- **トークン CSS**: [`../tokens/srd.css`](../tokens/srd.css)
- **用途**: A3 横・フィボナッチ余白のルール要約 HTML

## 思想

- Fibonacci で余白とフォントサイズを決める
- 上品・落ち着いた 4 色前後
- 絵文字なし・オープンな多カラム

## Spacing（Fibonacci）

| トークン | 値 |
|----------|-----|
| --sp-5 | 5px |
| --sp-8 | 8px |
| --sp-13 | 13px |
| --sp-21 | 21px |
| --sp-34 | 34px |
| --sp-55 | 55px |

## Font size（Fibonacci）

| トークン | 値 |
|----------|-----|
| --fs-8 | 8px |
| --fs-13 | 13px |
| --fs-21 | 21px |
| --fs-34 | 34px |
| --fs-55 | 55px |

## カラー

| トークン | 値 |
|----------|-----|
| --primary | `#333333` |
| --secondary | `#7f8c8d` |
| --accent | `#900c3f`（Deep Ruby） |
| --purple | `#5b2c6f` |
| --gold | `#c5a059` |
| --bg-color | `#faf9f6` |
| --text-main | `#444444` |
| --border-light | `#bdc3c7` |

## 印刷

- `@page { size: A3 landscape; margin: 0; }`
- container 幅目安: 420mm
