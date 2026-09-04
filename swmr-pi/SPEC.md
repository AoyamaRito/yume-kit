# SPEC: Single Writer / Multiple Readers — AI自走開発の並列化原則 v1.0

// @why: ユーザー提示の原則文書をワークスペースの仕様として保存。AGENTS.md「Worktree：特殊ケースのみ」の並列運用を「実装は並列化せず情報取得だけ並列化する」と定義する補完原則。コード=shared mutable state（Writeは水平スケールしない）、情報探索=独立（Readは水平スケールする）という整理で、並列マルチエージェントを日常運用としない方針と矛盾せず、むしろ「並列してよい範囲」を明確化する。
// @tags: SPEC

> **配布用コピー**: この SPEC.md は `grok_build/00_SPEC-swmr.md`（正本）の配布用コピー。正本の更新時はこちらにも反映する（またはパッケージを再ビルドする）。

- 状態: v1.0 原則文書（ユーザー提示のまま保存） / 更新: 2026-08-27
- 位置づけ: AGENTS.md「Worktree：特殊ケースのみ」の補完。並列を使う特殊ケースでは、この原則に従う。
- **適用注記**: pi.dev での適用形は `swmr-pi/DESIGN.md`。本 SPEC の「Main Agent が設計・実装・最終判断を行う」は適用形で再分配済み（設計→planner、実装→dev、最終判断→人間）。interview（人間への聞き取り）は適用形で MAIN のヒアリングに統合、reviewer は適用形で新設。本 SPEC は原則の正本としてそのまま保存する。
- **モデル注記**: §8「安いモデル」は例示であり、コスト最小化を要件としない（適用形のモデル割り当てが正）。

## 0. 原則

コードは並列化しない。情報だけ並列化する。

AIによる設計・コーディングを複数エージェントへ分割すると、共有状態、設計思想、変更箇所、前提条件の同期が必要になる。

AIはもともとコードを書く速度が非常に速いため、実装を並列化して得られる利益より、

* 文脈の分裂
* 設計の不一致
* 重複実装
* コード競合
* マージ
* エージェント間通信
* 責任範囲の曖昧化

による損失のほうが大きくなりやすい。

したがって、設計・意思決定・コーディング・修正を行うMain Agentは常に1体とする。

一方、情報取得は基本的にread-onlyであり、相互に競合しない。

そこで並列化対象を「実装」ではなく「情報取得」に限定する。

⸻

## 1. Architecture

```
                    ┌─ Research Agent A
                    │   Web / Docs / API
                    │
                    ├─ Research Agent B
                    │   Existing implementations
                    │
Human ─ Interview Agent
                    │
                    ├─ Inspect Agent
                    │   Existing codebase
                    │
                    └─ Research Agent N
                              │
                              ▼
                       Information
                              │
                              ▼
                        MAIN AGENT
                  ┌───────────────────┐
                  │ Design            │
                  │ Decision          │
                  │ Coding            │
                  │ Debugging         │
                  │ Integration       │
                  └───────────────────┘
                              │
                              ▼
                           Product
```

⸻

## 2. Single Writer

Main Agentだけがプロジェクト状態を変更できる。

Main Agentの責務：

* 要求の解釈
* WHYの維持
* アーキテクチャ設計
* 技術選択
* 最終判断
* コーディング
* リファクタリング
* デバッグ
* E2E結果からの修正
* 情報の統合

設計とコードを別エージェントへ分割しない。

設計したAI自身が、その設計を保持したまま実装する。

⸻

## 3. Multiple Readers

Reader Agentはプロジェクトを変更しない。

仕事は情報を取得してMain Agentへ返すことだけ。

代表例：

**Research Agent** — 外部情報を調査する。

* Web
* API仕様
* ライブラリ
* ドキュメント
* 技術比較
* 既存事例
* セキュリティ情報
* 競合製品

**Inspect Agent** — 既存プロジェクト内部を調査する。

* 関連コード
* 既存機能
* 依存関係
* 過去の設計判断
* 変更影響範囲
* 利用可能な既存部品

**Interview Agent** — 人間から情報を取得する。

* 本当に欲しいもの
* 優先順位
* 制約
* 好み
* 許容可能な妥協
* 曖昧な要求
* 矛盾した要求

Main Agent自身が長いヒアリングを抱え込む必要はない。

⸻

## 4. Readerの出力

Main Agentへ生ログを大量に渡さない。

Readerは情報を圧縮して返す。

推奨形式：

```json
{
  "facts": [],
  "constraints": [],
  "unknowns": [],
  "conflicts": [],
  "recommendations": [],
  "evidence": []
}
```

Main AgentはReaderの結論を盲目的に採用しない。

Readerは判断者ではなく情報提供者である。

最終判断は必ずMain Agentが行う。

⸻

## 5. なぜ情報だけなら並列化できるのか

コードはshared mutable stateである。

```
Agent A ─┐
Agent B ─┼─> SAME CODEBASE
Agent C ─┘
```

複数Writerが存在すると同期が必要になる。

一方、情報探索は基本的に独立している。

```
Research A ──┐
Research B ──┤
Inspect C  ──┼─> Main Agent
Interview D ─┤
Research E ──┘
```

AがAPIを調べていることと、Bが競合製品を調べていることは衝突しない。

したがって、

**Readは水平スケールする。Writeは水平スケールさせない。**

⸻

## 6. Map → Reduce → Write

この方式は次のようにも表現できる。

```
MAP
│
├── research()
├── inspect()
├── interview()
├── search()
└── analyze()
        │
        ▼
REDUCE
        │
    Main Agent
        │
        ▼
WRITE
        │
    Main Agent
```

多数のAgentが探索空間を並列に調べる。

Main Agentが結果を統合する。

Main Agentだけが状態を変更する。

⸻

## 7. 投機的調査

Readerは安価なら大量に起動してよい。

Main Agentが「後で必要になる可能性がある」と思った情報も先行して調査できる。

```
Main ───── implementation ───────────────>
      ├ research API ────────┐
      ├ inspect auth ─────┐  │
      ├ research security ───┤
      └ research examples ─────┐
                               ▼
                        results available
```

Main AgentはReader終了を待つ必要もない。

別の作業を進め、必要になった時点で完了済みの情報を利用する。

⸻

## 8. モデルを統一する必要もない

ReaderとWriterで同じLLMを使う必要はない。

例：

* Main Agent: Gemini / MiniMax / Claude / etc.
* Research: cheap fast model
* Inspect: cheap coding model
* Interview: conversational model
* Difficult Research: strong reasoning model

タスクに必要な能力に応じてモデルを選択する。

高価なモデルを全Agentへ配置する必要はない。

⸻

## 9. 期待される効果

最大の目的は単純なコーディング速度向上ではない。

**手戻りを減らすこと**である。

従来：

```
Design
 ↓
Code
 ↓
Problem discovered
 ↓
Research
 ↓
Redesign
 ↓
Rewrite
```

SWMR：

```
Parallel Research
       ↓
Information Integration
       ↓
Design
       ↓
Code
```

AIはコード生成自体が高速である。

したがって、

**コードを2倍速く書くことより、間違ったコードを一度書かないことのほうが重要**になる。

期待される改善：

* 設計判断の品質向上
* ハルシネーション低減
* API仕様誤認の低減
* 既存コード見落とし低減
* 人間要求の誤解低減
* 手戻り低減
* Main Agentのコンテキスト汚染低減
* 長時間自走の安定性向上
* 調査待ち時間の短縮

⸻

## 10. 実装原則

最初は複雑にしない。

必要なのは例えば次の3種類だけでよい。

```
research(question)
inspect(question)
interview(question)
```

そして絶対条件：

**Reader Agentにwrite権限を与えない。**

Readerは読んで、考えて、報告して終了する。

Main Agentだけがプロジェクトを変更する。

⸻

## 11. 仮説

従来のMulti-Agent Software Developmentは、

「複数のAIプログラマーをどう協調させるか」

を考える。

Single Writer / Multiple Readersは逆に、

「AIプログラマーを協調させない」

ことから始める。

実装状態を所有するAIは1体だけ。

他のAgentはすべて、その1体のための一時的な情報取得器として存在する。

⸻

## 12. 一文で表す

**並列に読む。一箇所で考える。一箇所で書く。**

または、

**コードは並列化しない。情報だけ並列化する。**

これをAI自走開発における基本的な並列化原則とする。