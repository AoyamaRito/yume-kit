# Core Principles (clearify)

This workspace prioritizes **clearify**: minimizing AI inference cost.
Human readability is secondary. **Redundancy is respected**; duplicate information is okay if it prevents the AI from searching. Avoid simple hiding/abstraction/DRY (refactoring) if it forces the AI to search. Aim for direct visibility of logic, dependencies, types, and history.

## yume-min History Convention (@why in-band)

When editing code, **embed the specification origin (why) of the change as a comment**: `// @why: [YYYY-MM-DD] reason`. Do not delete @why comments (Delete What, Keep Why). Preserve history by appending, not overwriting.
Structural intent is shown with `// @tags: SPEC`.

## Evidence-Based Work

Show output logs, file contents, and command results as **evidence**, not just claims. This workspace runs on verifiable evidence.