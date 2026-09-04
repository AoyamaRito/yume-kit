# 盗む単位チェックリスト（オフライン）

新しい画面・資料を作る前に、ローカル DS を決めたうえで以下を埋める。

## 1. トークン

- [ ] 色: 背景 / 文字 / ボーダー / アクセント（1 色に絞るか）
- [ ] 余白スケール（固定 px or Fibonacci or 4/8 ベース）
- [ ] 半径・影の段階
- [ ] タイポ: 見出し / 本文 / ラベルの 3 段以上

→ 参照: `../tokens/*.css` または `../systems/*.md`

## 2. コンポーネント解剖

- [ ] 状態: default / hover / focus / disabled / error
- [ ] サイズ: sm / md / lg
- [ ] 密度: comfortable / compact（必要なら）

→ 参照: external/primer-carbon-spectrum.md

## 3. 原則・コンテンツ

- [ ] 誰向けか 1 文
- [ ] 最重要情報は何か 1 つ
- [ ] 文言トーン（ですます / 体言止め / 英語 UI）

→ 参照: systems/lecture.md, external/polaris-atlassian-material.md

## 4. 配布

- [ ] このプロジェクトではトークンをどこに置くか（単一 HTML / CSS ファイル / tokens/）
- [ ] 他プロジェクトにコピーするか、symlink するか

## 5. 美学の方向（1 つ選ぶ）

| 方向 | ローカル起点 | 外部要約 |
|------|--------------|----------|
| プレゼン暗系 14U | systems/14u.md | spectrum 階層 |
| ライト高コントラスト | systems/kikaku.md | shadcn light |
| ブランド LP | systems/freebullet.md | polaris |
| 印刷 A3 | systems/srd.md | carbon spacing |
| 和モダン執筆 | systems/hudeato.md | japan.md |
