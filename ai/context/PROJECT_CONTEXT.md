# Project Context

## Project One-Liner

`codex-hardflow` is a coverage-first workflow governance harness for Codex
and future coding agents. It focuses on broad research coverage,
executor/validator separation, and programmatic parallel execution for
clearly independent work.

It is not intended to become a generic multi-agent chat framework.

## Project Goals

- Expand search beyond default Codex behavior when external information may
  matter.
- Make research auditable through plans, evidence, reports, and coverage gates.
- Separate executor and validator roles so implementation cannot optimize
  directly against hidden validation cases.
- Support a repair loop: executor implements, validator checks, validator
  returns sanitized feedback, executor repairs, and validation repeats until
  pass, blocked, or not configured.
- Run clearly independent research buckets or modules in parallel through
  programmatic orchestration rather than soft prompt instructions.
- Keep future productization open to non-Codex coding-agent providers where
  practical.

## Architecture Map

- CLI: route, research, report, coverage eval, diagnostics, validation, and
  future research request commands.
- Flag parser: typed CLI flags and clear failure behavior for agent-facing
  commands.
- Router / LLM Router: semantic task routing with schema normalization and
  deterministic safety gates.
- CoveragePlan: converts route output into required research coverage.
- SearchEngineRegistry: maps source buckets to available search engines.
- EvidenceLedger: stores auditable evidence items and should eventually support
  claim anchors.
- Research orchestrator: owns run IDs, router traces, runner modes, report
  skeletons, evidence backfill, and current/latest safety.
- SDK research runner: strict programmatic worker backend for bucket research.
- Diagnostics isolation harness: isolates repo/home/run IDs for experiment
  variants and checks contamination.
- Reports / coverage eval: summarize runner mode, evidence mode, coverage, and
  programmatic execution claims.
- Hidden validation: planned executor/validator separation with sanitized
  feedback, private checks, regression bank, and final holdout.
- Parallel modules: planned or partial support for path scope, shared
  contracts, parallel workers, merge gates, and full validation.

## Key Modules

- `src/cli.ts`: CLI entry behavior.
- `src/flagParser.ts`: typed flag parsing and boolean/string handling.
- `src/router/`: routing schema, prompt, normalization, trace, and fallback.
- `src/researchOrchestrator.ts`: research run orchestration.
- `src/research/sdkResearchRunner.ts`: SDK worker research backend.
- `src/diagnostics/`: SDK diagnostics and isolation support.
- `src/validators/`: validation helper tooling.
- `src/sourceMatrix.ts` and `src/coverageEval.ts`: coverage and evidence
  evaluation surfaces.
- `docs/`: durable protocol documentation.
- `ai/`: ChatGPT-Codex handoff context, plans, decisions, and reports.

Verify exact paths before implementing against this map.

## Diagnostics Concepts

- Bucket: source category such as official docs, GitHub, academic, package
  registry, security, competitors, local repo, or default discovery.
- Required bucket: must produce evidence, no-signal, or explicit exclusion.
- All-required parallel: run all required buckets concurrently.
- Baseline concurrency: comparison concurrency such as `maxConcurrentBuckets=3`.
- Transient retry: retry handling for network or service transient failures.
- Progress taxonomy: activity progress, artifact progress, semantic progress.
- Checkpoint nudge: prompt a worker to write a checkpoint when activity exists
  without artifact progress.
- Contamination detection: diagnostics isolation signal; contaminated
  experiment results are not trustworthy.
- Strict programmatic: SDK or deterministic runner execution without App,
  manual, AGENTS, or skill fallback.
- SDK threads: current strict programmatic worker backend direction.
- App subagents: temporarily abandoned as strict backend; possible future
  fallback only if SDK execution proves infeasible.

## Current Research Themes

- Exhaustive or all-required source coverage for research-heavy tasks.
- SDK threads as the strict programmatic backend.
- Whether all-required parallel should become the default research direction.
- Worker source return policy, including avoiding overly rigid small caps.
- Broad shallow probing before deep worker research.
- Hidden validator runner design and isolation.
- Future provider abstraction without bloating the current Codex-focused system.

## Known Evidence

- The all-parallel stress experiment completed as a small isolated experiment.
- Recorded result summary from current handoff files:
  - baseline concurrency `3`: completedRate `0.8571`, failedRate `0.1429`,
    medianDurationMs `522481`, averageCoverageScore `99`.
  - all_parallel concurrency `7`: completedRate `1`, failedRate `0`,
    medianDurationMs `115798`, averageCoverageScore `100`.
  - decision logic: `durationImprovement=0.7784`, `coverageDelta=1`,
    `stabilityRegression=false`, recommendation
    `all_required_parallel_viable`.
- This evidence supports all-required parallel as promising, but it remains a
  small experiment and should not by itself prove implementation default status.
- Hidden validator runner status must be verified in repo code before claiming
  it exists beyond scaffold/planned behavior.

## Known Non-Goals

- Do not turn codex-hardflow into a general CrewAI/LangGraph-style runtime.
- Do not rely on AGENTS.md, skills, or user phrasing as a hard execution
  trigger.
- Do not use keyword/rule-based classification as the primary router.
- Do not keep expanding diagnostics indefinitely when evidence is enough to
  make a design decision.
- Do not claim broader-than-default research, hidden validation, or strict
  programmatic execution without artifacts.
- Do not store secrets, tokens, `.env` contents, raw logs, hidden fixtures, or
  sensitive personal data in repo context.

## User Working Preferences

- Chinese is preferred unless the user asks otherwise.
- ChatGPT Web should act as Architect / Reviewer / experiment interpreter.
- Codex should act as Scout / Builder / Tester / Git operator.
- The user values aggressive coverage over cost minimization.
- The user prefers all-required parallel over conservative or adaptive defaults
  unless all-required shows real problems.
- The user dislikes keyword/rule-based primary classification.
- Commit/push policy has varied by task; follow the current user instruction
  and `AGENTS.md` for each turn.
- Safety checklists are useful but should not become ceremonial friction.

## Source Priority

Use sources in this order:

1. Current repo files and the active PR/diff.
2. `ai/context/CURRENT_STATE.md`.
3. `ai/context/PROJECT_CONTEXT.md`.
4. `ai/context/REVIEW_PROTOCOL.md`.
5. `ai/decisions/DECISION_LOG.md`.
6. The active plan under `ai/plans/`.
7. The latest `ai/reports/CODEX_REPORT.md`.
8. Uploaded artifacts and command outputs.
9. Old ChatGPT memory only as unverified historical context.

## What Must Not Be Inferred Without Evidence

- That all-required parallel is already the code default.
- That exhaustive coverage mode is fully implemented.
- That hidden validator runner, regression bank, or final holdout are complete.
- That App subagents are reliable strict execution backend.
- That worker source limits have been changed.
- That multi-provider support exists.
- That diagnostics results generalize beyond their sample size.
- That current state is fresh if files show stale branch names, old plans, or
  contradictory reports.

## Last Updated

2026-06-12
