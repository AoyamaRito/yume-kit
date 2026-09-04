# design-system — AI のための UI 決定層 ＆ オフラインハブ

// @why: 「UI をどうデザインするか」の決定権（思想・原則・実装例）を yume-kit に組み込み、layout-cli（配置計算層）と対で「作る → 検証する」を閉じるため。
// @why: [2026-08-28] grok_build/design からローカル参照ハブ（hub.html / systems / tokens / external / DESIGN_RULES / LP等）を pi_root/yume-kit/design-system へ完全移設。pi_root 単独でオフラインデザインハブ・トークン参照・UI思想決定が完結できるようにした。
// @tags: SPEC, DESIGN_SYSTEM

**「色々できる理由がない。」** 単機能・直列3ステップ・企画意図逆算・自然言語E2E — これがこのワークスペースの Web アプリ・UI を作るときの**決定権（思想）**です。

## 開き方（オフライン総合ハブ）

```bash
# ブラウザでハブを開く
open yume-kit/design-system/hub.html
# または
python3 -m http.server 8765 --directory yume-kit/design-system
# → http://localhost:8765/hub.html
```

## 構成

| パス | 内容 |
|------|------|
| `PHILOSOPHY.md` | **★正本: デザイン思想録（全13章・連番）** |
| `kazari-studio/` | 思想を実装した実戦アプリ（自然言語E2E + 単体テスト付き）。「思想 → 実装 → 検証」の動く見本 |
| `hub.html` | **★総合ハブ（ブラウザで閲覧・各資産へのワンクリック入口）** |
| `INDEX.md` | 全文テキスト索引 |
| `DESIGN_RULES.html` | 14U ルールブック HTML（グリッド・余白・色の正本） |
| `linear-design-system-lp.html` | 単機能・直列 DS 思想解説 LP（動く直列デモ・伝統色切替） |
| `design-lecture.html` | デザイン講義スライドデッキ（情報の整理） |
| `tokens-preview.html` | トークン色見本（全系統の視覚比較） |
| `14u-*.html` | 14U グリッド／カードの配置デモ |
| `systems/` | 各デザインシステム解説・ルール（14U, kikaku, freebullet, srd, hudeato, lecture, illustration） |
| `tokens/` | CSS 変数・デザイントークン集（コピペ用） |
| `fonts/` | 🔤 フォント収集所 + ライセンス台帳（`tools/fontscan.mjs` で自動 Web 化） |
| `font-hub.html` | 🔤 フォント試し打ち & ライセンス記録カタログ（自動生成） |
| `tools/` | 生成ツール（fontscan.mjs = フォント → CSS/JSON/台帳/ハブ） |
| `external/` | 世界のデザインシステム オフライン要約（shadcn, Primer, Carbon, Spectrum, Polaris, Atlassian, M3, デジタル庁, Spindle 等） |

## 思想の要（= PHILOSOPHY 13章）

1. 根本仮説 — 単機能・超速完走
2. 企画意図からの逆算（Who / What / Outcome）
3. 主要UI（85-90%）と枝葉UI（10-15%）の峻別
4. 直列遷移（Linear, One-Way Flow）
5. Sane Defaults（80点デフォルト）と Skip
6. 自然言語 E2E Snowball（仕様 ＝ テスト ＝ エビデンス）※yume-min / yume-spec の snowball と同型
7. DONE の静寂Dim（明度フィルター）
8. 線の省略と急所の線
9. 左右 HUD（ボタン＋物理キー）
10. Marching Dotted Frame
11. エラー・危険操作の物理的伝達（Shake / Tint / 警告Tooltip）
12. 用の美（モノトーン・フィボナッチ・伝統素材・1色アクセント）
13. AI が自走するときの思考順序

## どのように使うか

このワークスペースで Web UI を作るときの一連の流れ：

```text
【決定】design-system/PHILOSOPHY.md  … UI をどう作るか（この思想）
  → 【配置】layout-cli  … 座標・密度・衝突・文字詰めの計算（配置計算層）
  → 【検証】yui（yume-spec） … レイアウト崩れ・遮蔽・極小タップの機械検証
  → 【履歴】yume-min / @why … 意図と変更を成層状に残す
```

- **design-system = 決定層**（どんなUIか）
- **layout-cli = 計算層**（どこに置くか・収まるか）
- **yui = 検証層**（崩れてないか）

## 実証例（kazari-studio）

思想を完全実装した Web アプリの見本です（test.js 9件 + e2e.mjs 4シナリオ 全PASS）。

```bash
cd yume-kit/design-system/kazari-studio
node test.js    # 単体（レンダリング・エクスポート検証）
node e2e.mjs    # 自然言語E2E（最速スキップ完走など）
```

新しいUIアプリを作るときは、この who/what → 直列3Step → 自然言語E2E の形を真似して作り、
E2Eを末尾追記（snowball）して通し全PASSを保つ。

## 旧 design/ との関係

- 旧 `design/`（ローカル参照ハブ・tokens / external / systems）は各プロジェクトの実験資産として残る。
- **思想の正本はここ `yume-kit/design-system/PHILOSOPHY.md`**。旧 design/PHILOSOPHY.md は履歴として残置。

---

## 組み込み判断メモ（2026-08-27）

- **なぜ入れるか**：yume-kit に「UI の決定権」が無く、layout-cli は計算層だけで「どんなUIか」を決める思想が不在だった。design-system はその決定層。
- **なぜ tokens/external を入れないか**：スナップショット（実体は各プロジェクト側）であり、重複の元。必要な時に設計/ から引く。
- **章番号修復**：旧 PHILOSOPHY は §6→11→13 と飛び、HUD/Marching/エラー/用の美/AI思考順が見出しなしだった（内容欠落ではなく構造が崩れていただけ）。連番1–13へ整えた（内容は原文のまま）。