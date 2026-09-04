# Snowball E2E & Evidence (Definition of Done)

When changing functionality, **append to `e2e.mjs` / `test.js` and ensure all tests pass from the start**. Present output logs, file contents, and command results as **evidence**, not just claims of success. This ensures verifiable completion.

## Verification Loop

1.  **Static Check (Post-Edit)**: After editing code, run `node yume-kit/tools/ycheck.mjs <target_dir>` to immediately catch syntax/unresolved imports before E2E.
2.  **Overview (New Dir)**: For unknown directories, use `node yume-kit/tools/yumap.mjs <dir>` to overview structure and @why.
3.  **Plan First (Large Tasks)**: For changes >15min or across multiple files, write a 1-paragraph DESIGN_PACKET before implementation.
4.  **Self-Correction Loop**: If E2E/tests fail, fix -> re-run all tests -> confirm OK with measurement before reporting. Issues remaining after 2 loops go to requirements (refine category).
5.  **Completion Check (Pre-Commit)**: Before reporting, confirm "all E2E PASS for target_dir + ycheck zero issues" as evidence.