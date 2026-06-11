# ChatGPT-to-Codex Plan Template

## Objective

Describe the user-visible goal and the desired repository state after Codex finishes.

## Plan Path

Record the path where this plan is saved, for example `ai/plans/PLAN.md`.

## Codex Report Path

Use `ai/reports/CODEX_REPORT.md` unless the task explicitly defines another report path.

## Current State Path

Use `ai/context/CURRENT_STATE.md` as the current task state source of truth.

## Project Context Path

Use `ai/context/PROJECT_CONTEXT.md` for stable project goals, architecture,
known evidence, non-goals, and user working preferences.

## Review Protocol Path

Use `ai/context/REVIEW_PROTOCOL.md` for ChatGPT review rules, source priority,
stale-state handling, output shape, and safety review.

## Non-Goals

List behavior, files, systems, or cleanup work that Codex must not change.

## Current Facts

Record the repo facts ChatGPT is relying on, including branch, stack, relevant existing behavior, and any known dirty state.

## Files Likely Involved

List the expected files or directories. Include a note if Codex should discover the exact files during scouting.

## Milestones

1. Scout the relevant code and docs without making changes.
2. Implement the smallest reviewable change for the objective.
3. Run the agreed verification commands.
4. Update `ai/reports/CODEX_REPORT.md` and `ai/context/CURRENT_STATE.md`.
5. Stop for review or prepare a draft PR, depending on the task instructions.

## Verification Commands

List exact commands Codex should run, for example:

```sh
npm run build
npm test
```

If a command is intentionally skipped, Codex must record why in the final report.

## Verification Result

Record pass/fail/skipped status for each verification command. If verification
is skipped, include the reason.

## Known Anomalies

List stale state, dirty working tree files, skipped checks, missing artifacts,
branch naming mismatches, or contradictions between plan/report/current state.

## Safety Checklist

- No direct push to `main`.
- No secrets, tokens, `.env` contents, raw traces, huge logs, or sensitive personal data.
- Product source/test changes are intentionally included, or confirmed not included.
- Unrelated dirty working tree changes are not staged.
- `ai/context/CURRENT_STATE.md` is updated before pushing or review handoff.
- `ai/reports/CODEX_REPORT.md` is updated before pushing or review handoff.

## Risk Areas

List files, behaviors, compatibility constraints, data handling concerns, or testing gaps that need extra care.

## Stop Conditions

Codex must stop and report instead of continuing if:

- The plan contradicts repository reality.
- Required files or commands are missing.
- Verification fails for reasons that are not clearly unrelated.
- Implementing the plan would require committing secrets, raw traces, huge logs, `.env` files, or sensitive personal data.
- The change would require pushing directly to `main` for a complex AI task.

## Final Report Requirements

Codex must update `ai/reports/CODEX_REPORT.md` with:

- Task
- Summary
- Files changed
- Commands run
- Verification result
- Deviations from plan
- Issues found
- Remaining risks
- Next ChatGPT question, including source priority, known anomalies, expected output format, and a request for the next Codex prompt

## Next ChatGPT Question

Include:

- Source priority: use uploaded files, the current PR, `ai/context/CURRENT_STATE.md`, `ai/reports/CODEX_REPORT.md`, and this plan before old chat memory.
- Known anomalies: stale state, dirty working tree, skipped checks, missing artifacts, or other caveats.
- Expected output format: plan, review findings, merge decision, or Codex-ready prompt.
- Next Codex prompt request: ask ChatGPT for the exact next prompt the user should give Codex.
