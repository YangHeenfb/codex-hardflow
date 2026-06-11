# Decision Log

## Three Core Project Goals

- Decision: codex-hardflow focuses on broader search coverage,
  executor/validator separation with repair loops, and programmatic parallel
  execution for clearly independent work.
- Status: confirmed.
- Rationale: These are the user's stated project objectives in the migrated
  legacy context.
- Evidence: Legacy context pack and existing handoff discussion.
- Related files: `ai/context/PROJECT_CONTEXT.md`.
- Follow-up: Keep README/docs aligned when product-facing docs are updated.

## Exhaustive Search Direction

- Decision: research-heavy workflows should prefer exhaustive or all-required
  coverage over conservative optional buckets.
- Status: confirmed as user preference; implementation status must be verified.
- Rationale: The user prefers higher cost and longer runtime over missing
  relevant sources.
- Evidence: Legacy context pack; current experiment results support broader
  parallel coverage.
- Related files: `ai/context/PROJECT_CONTEXT.md`, `ai/context/CURRENT_STATE.md`.
- Follow-up: Verify whether code defaults implement exhaustive/all-required
  behavior.

## All-Required Parallel Direction

- Decision: all-required parallel is the preferred default direction unless
  real usage shows concrete problems.
- Status: confirmed as user direction; experiment-only as empirical proof.
- Rationale: The all-parallel stress result was faster and did not show a
  stability regression in the small sample.
- Evidence: `ai/context/CURRENT_STATE.md`, `ai/reports/CODEX_REPORT.md`,
  all-parallel diagnostics summary.
- Related files: `ai/context/PROJECT_CONTEXT.md`.
- Follow-up: Verify whether all-required is actually implemented as default.

## Adaptive Concurrency

- Decision: adaptive concurrency is not preferred unless all-required shows
  real problems.
- Status: confirmed as preference.
- Rationale: The user wants maximum useful parallelism and does not want to
  over-optimize diagnostics before design progress.
- Evidence: Legacy context pack.
- Related files: `ai/context/PROJECT_CONTEXT.md`.
- Follow-up: Revisit only if all-required causes concrete failures.

## App Subagents As Strict Backend

- Decision: App subagents are temporarily abandoned as the strict programmatic
  backend.
- Status: confirmed current direction.
- Rationale: Legacy reports indicate App subagents were not reliably
  programmatic and may depend on user-visible prompting.
- Evidence: Legacy context pack.
- Related files: `ai/context/PROJECT_CONTEXT.md`.
- Follow-up: Revisit only if SDK threads prove infeasible.

## SDK Threads As Strict Backend

- Decision: SDK threads are the current strict programmatic worker backend.
- Status: confirmed direction.
- Rationale: SDK workers are controlled by codex-hardflow rather than App UI or
  model discretion.
- Evidence: all-parallel stress experiment used strict programmatic SDK
  threads.
- Related files: `ai/context/PROJECT_CONTEXT.md`,
  `ai/reports/CODEX_REPORT.md`.
- Follow-up: Keep diagnostics isolation and artifact checks around SDK runs.

## Hidden Validator Runner

- Decision: hidden validator runner remains a major future feature, but should
  not be claimed complete without repo evidence.
- Status: planned.
- Rationale: It is one of the core goals, but legacy context describes current
  behavior as scaffold/not_configured.
- Evidence: Legacy context pack.
- Related files: `ai/context/PROJECT_CONTEXT.md`.
- Follow-up: Write a dedicated implementation plan before coding it.

## Computed Router Confidence

- Decision: computed confidence is deferred.
- Status: confirmed current deprioritization.
- Rationale: Coverage, SDK execution, hidden validation, and parallel execution
  are higher priority.
- Evidence: Legacy context pack.
- Related files: `ai/context/PROJECT_CONTEXT.md`.
- Follow-up: Revisit after core workflow capabilities are stable.

## Next ChatGPT Question

- Decision: next ChatGPT questions are useful, and when present must include
  source priority, known anomalies, expected output format, and a request for
  the next Codex prompt.
- Status: confirmed operational rule.
- Rationale: This prevents old chat memory from overriding repo state.
- Evidence: User instruction on 2026-06-12.
- Related files: `AGENTS.md`, `.github/pull_request_template.md`,
  `ai/plans/TEMPLATE.md`.
- Follow-up: Existing reports may be updated opportunistically when touched.

## Auto Commit And Push

- Decision: commit/push permission is task-specific and must follow the current
  user instruction and `AGENTS.md`.
- Status: confirmed operational rule.
- Rationale: User preferences have varied by task; blind pushes are unsafe in a
  dirty worktree.
- Evidence: Current `AGENTS.md` push policy and legacy context pack.
- Related files: `AGENTS.md`, `ai/context/REVIEW_PROTOCOL.md`.
- Follow-up: Ask or stop when the current task does not explicitly authorize
  push.

## Multi-Provider Future Direction

- Decision: future productization should avoid permanently locking the design
  to Codex-only APIs.
- Status: future direction.
- Rationale: The user wants future support for other coding-agent providers.
- Evidence: Legacy context pack.
- Related files: `ai/context/PROJECT_CONTEXT.md`.
- Follow-up: Do not add abstraction until it removes real complexity or supports
  a concrete provider boundary.
