---
name: present-skill
description: "HTML パワポ風プレゼン生成。JSON スライド定義 → 単一 HTML + PDF を自動生成（テーマ切替・←→キー遷移・yui 検証可能）。コマンド: node yume-kit/tools/present/present.mjs <slides.json> --out file.html --theme vermilion|indigo|gold|dark --title タイトル --no-pdf でPDF抑制"
---

// @why: [2026-09-05] ユーザー要望「pdf化も自動で行われると最高だね」→ 生成時に HTML と同時に PDF を自動生成（headless Chrome print-to-pdf・依存ゼロ。印刷 CSS を内蔵）。
// @why: [2026-09-05] frontmatter の description をダブルクォートで包み、[ ] で囲んだオプション表記と内側引用符を除去（YAML が [ を flow 記法と誤認し「Nested mappings are not allowed in compact mappings」でスキル読込失敗）。kantoku-watch SKILL.md と同じ安全な記法に揃えた。
// @why: [2026-09-04] ユーザー要望「プレゼンを作る機会が多いのでスキル化したい。HTML で作成するほうがいい、パワポ風にする」。既有実績 presentations/design-system-presentation.html の思想（テーマ切替・フィボナッチ余白・キー遷移）を雛形に、JSON から単一 HTML を生成する依存ゼロ CLI として pi スキル化。
// @tags: SPEC, PRESENTATION

# present-skill — HTML パワポ風プレゼン生成

プレゼンを **1 ファイルの HTML（ブラウザで全画面・←→キーで遷移）** として作る。パワポ風に「1 画面 = 1 スライド」で、デザインは design-system の思想（テーマ切替・フィボナッチ余白・キー遷移）を内蔵している。毎回デザインを 0 から考えない（clearify: 探させない）。

## 使い方

```bash
cd yume-kit/tools/present

# 1) スライド定義 JSON を書く
# 2) 生成（HTML と PDF を同時に自動生成）
node present.mjs slides.json -o out.html --theme indigo
#    → out.html と out.pdf（16:9・各スライド 1 ページ）ができる
#    → PDF を手動で出したくなければ --no-pdf を付ける

# 3) 検証（レイアウト破綻の自動検査）
#    ※ 生成時に「不自然な改行チェック」も自動で走る（--no-check で抑制）
yui out.html

# 4) 共有 / 映写
open out.html
#    配布用には out.pdf を渡すだけで OK（プレゼン中は HTML 全画面）
```

## slides.json の形式

```json
{
  "title": "プレゼンタイトル",
  "theme": "vermilion | indigo | gold | dark",
  "slides": [
    { "title": "表紙", "subtitle": "サブタイトル" },
    { "title": "内容", "bullets": ["A", "B", "C"] },
    { "title": "技術", "code": "const x = 1;", "note": "補足" }
  ]
}
```

## テーマ

| テーマ | 色 | 用途 |
|---|---|---|
| `vermilion`（既定） | 朱 | 決断・実行・日本 |
| `indigo` | 藍 | 知的・静謐・信頼 |
| `gold` | 金 | 格式・成就発表 |
| `dark` | 漆黒 | 没頭・夜・演出 |

## 操作（映写中）

- `→` / `Space` / `PageDown` … 次へ
- `←` / `PageUp` … 前へ
- `Home` / `End` … 先頭 / 末尾

## 設計の要点

1. **1 ファイル完結**（CSS/JS 内蔵・依存ゼロ・file:// で開ける）
2. **1 画面 = 1 スライド**（パワポの「順に並ぶ自己完結ページ」を HTML で再現）
3. **PDF 自動生成** — headless ブラウザ（Chrome/Edge）で印刷用 CSS（@media print：各スライド 1 ページ・16:9）を実印刷。依存ゼロで自動 PDF が手に入る
4. **検証** — 生成後に `yui <file>` でレイアウト破綻（はみ出し・遮蔽・極小タップ）を自動チェック（人間の目に頼らない）
5. **改行チェック自動** — 生成時に不自然な折り返し（孤立行・禁則）を自動検出（`check-linebreak.mjs` を内包）。毎回手で確認しなくていい。
5. **テーマ切替** — CSS 変数（tokens）を変えるだけ。中身（スライド）はそのまま

## テスト

```bash
cd yume-kit/tools/present
node test.mjs   # 生成→スライド内包・エスケープ・テーマ切替・CLI 実走を検証（snowball 方式）
```