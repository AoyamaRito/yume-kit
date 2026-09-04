# yume-min — 唯一の正本コア（構造・認知・永続化）

yume-kit の**唯一の正本コア**。yume-lite は廃止・退避済みで、これ一本。

## 核心概念

- **ブロック**: 実体・append-only キャップ付き履歴（直近 ~32 版が見える）
- **グラフ**: refs / children / tags による構造
- **expand / apply**: スコープした部分グラフを一枚の直編集・ハッシュ保護ビューにし、変更を新バージョンとして戻す（Virtual Heavy）
- **skeleton / readPartial**: トークン効率のための安い構造ビューと部分ボディ読み
- **getSurface / getImpact**: 5k-15k+ LOC スケールで高レバレッジに働く最小ツール
- **wedge（緑ゲート）**: e2e 緑でなければ版を畳まない絶対条件（履歴管理）
- **persist / lift / cover**: 平文 JSON・全言語対応 lift・coverage-gap 検証の目
- **ドメインタグ付き値**（`world:` / `usd:` / `time:` など）: LLM ファースト型付けの基本規約
- **統一 2 段実行モデル**: current + input → input_constraint → state_constraint/derive → commit（状態機械の遷移ではなく、どの状態でも同じ処理論理が通る）

## 思想

**clearify**: AI の推論コスト最小化が目的（主体は AI）。冗長性を尊重し、単純な隠匿・抽象化・DRY 的整理はしない。論理・依存・型・履歴が、最小の推論で直接見える状態を目指す。