# yume-kit — AI Self-Driving Development Suite

This is the unified yume-kit, organized into core components for AI agents.

## Structure

- `tools/`: **汎用ツール** — Node だけで動く、pi に依存しない CLIs（ycheck / yumap / layout / present / ctxlog / image-compose / fal-h3 / read_prompts 等）。
- `pi_extensions/`: **pi 専用アセット** — pi の拡張 API・スキル・プロンプトテンプレート（pi でしか動かないもの）。別パッケージとして pi install で登録。
- `prompts/`: Core principles, guidelines, and context for the AI agent（概念要約。read_prompts ツールが読む）。
- `ui/`: yume-spec の UI 健全性検証モジュール（extractor.js + index.js）。
- `ai-tools/` / `design-system/` / `yume-min/` / `pi-dashboard/` / `swmr-pi/`: 各モジュール実体。
- `README.md`: This documentation, serving as the central map.

## 区分の原則

- **`tools/` = 汎用**（pi に依存しない。Node だけで動く。ベンチ環境でもそのまま使える）
- **`pi_extensions/` = pi 専用**（pi の拡張 API・スキル・プロンプトテンプレート。pi が無いと動かない）

ベンチ（Harbor）では `tools/` だけを `/opt/pi/tools/` に配置する。pi では `yume-kit`（tools の bin）と `yume-kit/pi_extensions`（skills/extensions/prompts）の 2 パッケージを settings.json に登録する。

## How to Use

### Tools

All tools are located in the `tools/` directory. You can execute them directly using `node yume-kit/tools/<tool_name>.mjs` or by calling them via pi (once integrated).

### Prompts

Core prompts are injected into the system. Use `read-prompts` (via pi) or `node yume-kit/tools/read_prompts/read_prompts.mjs` to list available prompts and read their content.

**Prompt notation conventions**:
- Files are `NN_name.md` (numbered, ordered). `NN` is the load order.
- Each file is a single topic. Keep it short; long prompts get skipped by LLMs.
- The first line (`# Title`) is the summary tag shown in the index.
- Complex conditional logic may use structured forms (pseudocode / YAML / JSON, see `04_complex_conditions.md`) to guide likelihood-based decisions.

**Prompt catalog** (each is a concept summary of a yume-kit module):
- `00_core`: clearify / @why / Evidence（核心思想）
- `01_bootstrap`: 開始時スキャン規約
- `02_snowball`: E2E 検証ループと完了の定義
- `03_tools`: ツール一覧と使いどころ
- `04_complex_conditions`: 複雑な条件分岐のプロンプト記述ガイド（確率的制約畳み込み）
- `05_yume_min`: 唯一の正本コア（expand/wedge/persist/clearify）
- `06_swmr`: Single Writer / Multiple Readers 運用・要件台帳
- `07_ai_tools`: 見えないものを見る道具箱（asset-gen/ui-graph 等）
- `08_design_system`: 単機能・直列 Web アプリ設計思想
- `09_log_clean`: 入力清書規約（常時適用）
- `10_pi_dashboard`: 並走 pi の Web 総合監視・集中管理
- `11_kantoku_watch`: 中間判定 AI judge（proceed/refine/halt）

### Getting Started

1. Read this `README.md`.
2. Use `read-prompts` to understand the AI's core principles.
3. Explore available tools in `tools/`.