# ChatGPT-to-Codex Plan Template

## Objective

Describe the user-visible goal and the desired repository state after Codex finishes.

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
- Suggested next ChatGPT review question
