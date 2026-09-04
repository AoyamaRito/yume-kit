# Available Tools (yume-kit)

All tools are located in the `tools/` directory of yume-kit. They can be executed from either location:

*   **Local workspace**: `node yume-kit/tools/<tool_name>.mjs`
*   **Bench container**: `node /opt/pi/tools/<tool_name>.mjs`

## 区分（tools vs pi_extensions）

- **`tools/` = 汎用**: Node だけで動く、pi に依存しない。ベンチ（/opt/pi/tools/）でもローカルでも同じ。
- **`pi_extensions/` = pi 専用**: pi の拡張 API・スキル・プロンプトテンプレート。pi が無いと動かない（pi install で登録）。

## Core Tools（汎用・pi 非依存）

*   `ycheck`: Static analysis for syntax and imports.
*   `yumap`: Overview code structure and embedded `@why` comments.
*   `presence`: Report missing `@why` comments for code changes.
*   `scan`: Internal utility for parsing code/specs.
*   `kantoku`: AI judge for intermediate decisions in long jobs.
*   `present`: Generate HTML presentations from JSON.
*   `ctxlog`: Tagged context log for session summaries and decisions.
*   `image-compose`: CLI for layered image composition.
*   `layout`: CLI for automatic typesetting and collision detection.
*   `fal-h3`: CLI for fal.ai MiniMax H3 video generation.
*   `read-prompts`: Lists and reads prompt files, including structured logic for complex decision flows.

## Usage Example

To see available prompts: `node yume-kit/tools/read_prompts/read_prompts.mjs` (or `node /opt/pi/tools/read_prompts/read_prompts.mjs` in bench)
To read core principles: `node yume-kit/tools/read_prompts/read_prompts.mjs 00_core`
To read a concept summary (e.g. yume-min): `node yume-kit/tools/read_prompts/read_prompts.mjs 05_yume_min`

## Concept Prompts (module summaries)

The `prompts/` directory also contains concept summaries of modules that are not standalone CLI tools. These describe the *idea* (not the code) and are loaded on demand:

*   `05_yume_min`: clearify / expand / wedge / persist — the single source-of-truth core
*   `06_swmr`: Single Writer / Multiple Readers + requirements ledger
*   `07_ai_tools`: asset-gen / ui-graph / ascii-3d / webqa / vision-qa / monte-carlo / ga4-monitor
*   `08_design_system`: single-purpose, linear web app design philosophy
*   `09_log_clean`: input cleaning convention (always-on)
*   `10_pi_dashboard`: parallel pi monitoring / central management
*   `11_kantoku_watch`: intermediate AI judge (proceed/refine/halt)