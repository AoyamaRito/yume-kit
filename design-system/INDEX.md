# デザインシステム — ローカル索引

- 更新: 2026-08-23
- **設計思想（正本）**: [`PHILOSOPHY.md`](./PHILOSOPHY.md)（単機能・直列・企画意図逆算・自然言語E2E）
- **実装見本**: [`kazari-studio/`](./kazari-studio/)（思想を実装した Web アプリ・test 9 + E2E 4 全PASS）
- **入口**: [`hub.html`](./hub.html)（ブラウザ） / [`README.md`](./README.md)
- 方針: **オフラインで完結**。外部サイトは要約を `external/` に置く。URL 一覧は `external/catalog.md` のみ。

---

## 開き方

```bash
open yume-kit/design-system/hub.html
# または
python3 -m http.server 8765 --directory yume-kit/design-system
# → http://localhost:8765/hub.html
```

---

## ローカル構成

| パス | 内容 |
|------|------|
| [`kazari-studio/index.html`](./kazari-studio/index.html) | **★実戦Webアプリ: 飾り文字工房（単機能・直列 3Step完走）** |
| [`linear-design-system-lp.html`](./linear-design-system-lp.html) | **★思想解説LP（動く直列デモ・伝統色切替付き）** |
| [`PHILOSOPHY.md`](./PHILOSOPHY.md) | **★最重要: 単機能・直列・企画意図逆算のデザイン思想録** |
| [`hub.html`](./hub.html) | 総合ハブ（推奨） |
| [`font-hub.html`](./font-hub.html) | **🔤 フォント試し打ち & ライセンス台帳（自動生成）** |
| [`fonts/`](./fonts/) | フォント収集所（放り込むだけで Web フォント化） |
| [`tools/fontscan.mjs`](./tools/fontscan.mjs) | ★フォント自動生成パイプライン（スキャン→CSS/JSON/台帳/ハブ） |
| [`DESIGN_RULES.html`](./DESIGN_RULES.html) | 14U ルールブック HTML |
| [`design-lecture.html`](./design-lecture.html) | 講義デッキ（ローカルコピー） |
| [`14u-fullscreen-grid.html`](./14u-fullscreen-grid.html) | グリッドデモ |
| [`14u-grid-cards.html`](./14u-grid-cards.html) | カードデモ |
| [`systems/`](./systems/) | 各 DS のルール正本（md） |
| [`tokens/`](./tokens/) | CSS 変数（コピペ用） |
| [`external/`](./external/) | 世界の DS オフライン要約 |

---

## systems/（ローカル正本）

| ファイル | 系統 |
|----------|------|
| [systems/14u.md](./systems/14u.md) | 14U グリッド（営業プレゼン） |
| [systems/kikaku.md](./systems/kikaku.md) | PuttyCrayme ライト高コントラスト |
| [systems/freebullet.md](./systems/freebullet.md) | free bullet LP |
| [systems/srd.md](./systems/srd.md) | SRD A3 Fibonacci |
| [systems/hudeato.md](./systems/hudeato.md) | 縦書き UI |
| [systems/lecture.md](./systems/lecture.md) | 講義の骨格 |
| [systems/illustration-jitsu.md](./systems/illustration-jitsu.md) | カードイラスト規約 |

---

## tokens/（CSS）

| ファイル | 用途 |
|----------|------|
| [tokens/14u.css](./tokens/14u.css) | navy / gold / orange + grid |
| [tokens/kikaku.css](./tokens/kikaku.css) | accent `#1E40AF` |
| [tokens/freebullet.css](./tokens/freebullet.css) | sky / blue LP |
| [tokens/srd.css](./tokens/srd.css) | Fibonacci sp/fs |
| [tokens/hudeato.css](./tokens/hudeato.css) | current + V3 washi |
| [tokens/all.css](./tokens/all.css) | import メモ |
| [tokens/fonts.css](./tokens/fonts.css) | 🔤 フォント @font-face + CSS 変数（自動生成） |

---

## external/（オフライン要約）

| ファイル | 内容 |
|----------|------|
| [external/shadcn.md](./external/shadcn.md) | shadcn + Radix |
| [external/primer-carbon-spectrum.md](./external/primer-carbon-spectrum.md) | Primer / Carbon / Spectrum |
| [external/polaris-atlassian-material.md](./external/polaris-atlassian-material.md) | Polaris / Atlassian / M3 |
| [external/japan.md](./external/japan.md) | デジタル庁 / Spindle |
| [external/steal-checklist.md](./external/steal-checklist.md) | 作業前チェック |
| [external/catalog.md](./external/catalog.md) | オンライン URL 一覧 |

---

## 用途別の見方

| 用途 | 見る順（すべてローカル） |
|------|--------------------------|
| 営業プレゼン | systems/14u.md → DESIGN_RULES.html → tokens/14u.css |
| ライト資料 | systems/kikaku.md → tokens/kikaku.css |
| 企業 LP | systems/freebullet.md → tokens/freebullet.css |
| A3 印刷 | systems/srd.md → tokens/srd.css |
| 縦書き UI | systems/hudeato.md → tokens/hudeato.css |
| 思想・教育 | systems/lecture.md → design-lecture.html |
| 今風アプリ UI の型 | external/shadcn.md → steal-checklist.md |
| 日本語原則 | external/japan.md |

---

## リポジトリ内ソース（正の実装）

トークンの**実装の正**は各プロジェクト側。`tokens/` は参照用スナップショット。以下のプロジェクト実体は `~/grok_build/` 側にあります（pi_root 未移植）。

| プロジェクト | パス |
|--------------|------|
| kazari-studio | `yume-kit/design-system/kazari-studio/` ← **pi_root 側に実体あり** |
| 14U | `design/DESIGN_RULES.html`（grok_build） |
| kikaku | `kikaku/styles.css`（grok_build） |
| freebullet | `freebullet-lp/index.html`（grok_build） |
| SRD | `SRD/SRD_基本ルール_A3.html`（grok_build） |
| hudeato | `hudeato/index.html`（grok_build） |
| イラスト | `実況凄腕営業マン/assets/STYLE_GUIDE.md`（grok_build） |

---

## 次の候補

- [ ] トークン変更時に systems/tokens を同期する運用
- [ ] 会社標準を 1 系統に決める
- [ ] design-lecture ルート原本との二重管理をやめる（ハブ側を正に）
