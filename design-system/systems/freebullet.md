# free bullet LP デザインシステム

- **ソース**: `../../freebullet-lp/index.html`（`:root` 内 tokens）
- **トークン CSS**: [`../tokens/freebullet.css`](../tokens/freebullet.css)
- **用途**: 企業 LP（現行 free-bullet.com トーン準拠）

## トーン

- 淡い空色 × 白 × ブランド青 × アクセント
- 見出しは明朝（Shippori Mincho）、本文はゴシック

## カラー

| トークン | 値 | 用途 |
|----------|-----|------|
| --ink | `#22314A` | 見出し |
| --ink-soft | `#333333` | 本文 |
| --steel | `#5B6B82` | 補足 |
| --paper | `#FFFFFF` | 紙面 |
| --sky | `#E8F1F8` | 淡い空色 |
| --sky-2 | `#D4E6F4` | |
| --blue | `#3A7BC8` | ブランド青 |
| --blue-2 / --accent | `#4A90D9` | メインアクセント |
| --accent-hover | `#3A7BC8` | ホバー |

※ 以前の ink `#0B1E3F` / red `#D64541` 版メモが残っている場合あり。**現行ソースの `:root` を正**とする。

## タイポ

| 役割 | フォント |
|------|----------|
| 見出し | Shippori Mincho / Yu Mincho / Noto Serif JP |
| 本文 | Noto Sans JP / Hiragino / Yu Gothic |
| mono / eyebrow | Space Grotesk |

## レイアウト

- max-width: **1180px**
- ease: `cubic-bezier(.22, .9, .32, 1)`
- セクション見出しは serif + 大きめ clamp
