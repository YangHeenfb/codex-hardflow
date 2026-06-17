# Legacy Context Backfill Pack for codex-hardflow

## Date

2026-06-12

## Source

Old ChatGPT Web planning conversation summary.

## Warning

This migrated summary is not automatically verified fact. Use repo files,
current PRs, command output, and durable decision records before relying on any
claim.

## 1. Project One-Liner

codex-hardflow is a programmatic workflow harness for Codex and, eventually,
other coding agents. It is not primarily a generic multi-agent chat framework.
It exists to solve three concrete problems:

1. Default search coverage is too narrow. The goal is to make Codex, and later
   other coding agents, search deeper and broader across many source types.
2. Coding agents can overfit to visible tests or validation criteria. The
   project should separate executor and validator roles and use sanitized
   feedback loops.
3. Clearly parallel work should execute in parallel through programmatic
   workers rather than relying on user phrasing or soft instructions.

The intended positioning is a coverage-first research, executor/validator
separation, and parallel execution governance layer for coding agents, not
another CrewAI/LangGraph-style runtime.

## 2. Project Goals

### Core Workflow Goals

- Expand search coverage beyond default Codex search behavior.
- Search many source types when they have a plausible chance of containing
  useful information.
- Prefer higher search cost and longer runtime over missing relevant sources.
- Make research auditable through artifacts, not just final prose.
- Separate executor and validator so executor cannot optimize directly against
  hidden validation cases.
- Maintain a repair loop: executor implements, validator checks, validator
  returns sanitized feedback, executor repairs, validator re-checks, repeat
  until pass, blocked, or not configured.
- Programmatically execute clearly independent modules in parallel.
- Avoid workflows that depend on soft triggers such as AGENTS.md, skills, or
  user-visible prompts.

### Diagnostics Goals

Diagnostics measure reliability and strategy decisions; they are not the
product goal. They should measure concurrency failure, bucket difficulty,
worker prompt width, transient network recovery, no-progress classification,
all-required parallel viability, and SDK-worker reliability.

The all-parallel stress experiment provided evidence to stop over-focusing on
conservative concurrency experiments. In the small isolated run, all_parallel
completed all seven buckets twice, with median duration `115798ms` and average
coverage `100`; baseline concurrency `3` completed six of seven buckets twice,
with median duration `522481ms` and average coverage `99`.

### Hidden Validation Goals

Hidden validation is a core long-term goal, but a real hidden validator runner
must not be treated as complete unless verified in the repo. The intended loop
keeps private fixtures, expected outputs, private paths, hidden test names, and
full hidden stack traces outside executor context, while returning sanitized
feedback for repair. Final holdout should be separate from exposed repair
feedback.

### Research Buckets, SDK Threads, And Isolation

Research buckets are coverage units. SDK threads are the preferred strict
programmatic worker backend. App subagents are temporarily abandoned as a strict
backend and should be revisited only if SDK execution proves infeasible.

Diagnostics isolation requires no shared `.agent` state, no current pointer
contamination, no cross-variant SDK thread reuse, no diagnostics output inside
worker cwd, and explicit run IDs.

## 3. Current Architecture Map

Verify exact paths before writing implementation against this map.

- CLI: route, research, report add-source, report finalize-manual,
  report assert-evidence, eval coverage, diagnostics, validate, and future
  research request commands.
- Flag parser: typed boolean/string flags with clear unknown-flag behavior.
- Router / LLM Router: semantic routing into direct answer, research,
  implementation, validation-sensitive implementation, parallel modules,
  hardflow maintenance, router_failed, clarify, or bypass.
- CoveragePlan: converts router output into executable source buckets,
  perspectives, research questions, engines, budgets, and gates.
- SearchEngineRegistry: records engines per bucket such as official docs,
  GitHub, academic, package registry, security, community, blogs, competitors,
  local repo, and default discovery.
- EvidenceLedger: stores evidence items and should support filtering and future
  claim anchors.
- Research orchestrator: coordinates run IDs, router traces, source matrices,
  runner mode, report skeletons, SDK/app/manual modes, and evidence backfill.
- SDK research runner: strict programmatic backend with worker state,
  heartbeat, checkpoints, partial evidence, retry, progress taxonomy,
  checkpoint nudge, and diagnostics metrics.
- Diagnostics isolation harness: isolated repo/home per variant, explicit run
  IDs, no latest/current shortcuts, no cross-variant thread reuse, and
  contamination checks.
- Reports / coverage eval: distinguish runner mode, evidence mode,
  programmatic trigger, programmatic multi-agent state, subagent status,
  SDK worker status, and coverage score.
- Hidden validation: planned hidden validator runner, command adapter, private
  store, isolated validation workspace, sanitizer, regression bank, final
  holdout, and validation summary.
- Parallel modules: detect path scope, separate shared contracts, execute
  independent modules in parallel, merge, and run full validation afterward.

## 4. Glossary

- bucket: source category such as official docs, GitHub, community, academic,
  package registry, security, engineering blogs, competitors, local repo, or
  default discovery.
- required bucket: bucket that must produce evidence, no-signal, or explicit
  exclusion.
- all_required parallel: running all required buckets concurrently.
- baseline concurrency: historical comparison concurrency, often
  `maxConcurrentBuckets=3`.
- transient retry: retry for transient network errors such as TLS EOF,
  ECONNRESET, socket hang up, ETIMEDOUT, EAI_AGAIN, or rate limits.
- progress taxonomy: activity progress, artifact progress, semantic progress.
- checkpoint nudge: request for a worker checkpoint when activity exists but no
  artifact progress exists.
- contaminationDetected: diagnostics result indicating isolation violation.
- strict_programmatic: strict SDK/deterministic runner mode with no
  App/manual/AGENTS/skill fallback.
- sdk_threads: programmatic Codex SDK worker backend.
- manual fallback: App/manual/web search backfilled through report CLI.
- App subagents: Codex App/CLI subagent feature, currently abandoned as strict
  backend.
- hidden validator: isolated validator that runs private checks and returns
  sanitized feedback.
- computed confidence: future router confidence, currently not priority.
- prompt width: breadth of worker prompt.
- adaptive concurrency: future telemetry-based concurrency strategy; not
  preferred unless all_required shows problems.

## 5. Timeline Of Important Decisions

- Project has three core goals. Status: confirmed.
- Search should be exhaustive/aggressive by default. Status: confirmed as user
  preference; implementation must be verified.
- all_required parallel is the preferred default direction. Status: confirmed
  user direction; exact implementation status unknown.
- Diagnostics have mostly served their purpose for concurrency. Status:
  confirmed as current direction.
- App subagents are temporarily abandoned. Status: confirmed current direction.
- SDK threads are the strict programmatic backend. Status: confirmed direction.
- Hidden validator runner is important but not immediate/current-complete.
  Status: planned.
- Computed confidence is not current priority. Status: confirmed.
- Future productization should not lock architecture to Codex-only APIs. Status:
  future direction.

## 6. Things Tried Or Ruled Out

- Do not keep trying to stabilize App subagents as strict backend now.
- Do not rely on AGENTS.md or skills to trigger hardflow.
- Do not use keyword/rule-based classification as primary router.
- Do not prioritize computed confidence now.
- Do not implement hidden validator runner before durable current context
  captures coverage/SDK direction.
- Do not continue over-experimenting on concurrency.
- Do not prioritize prompt-width diagnostics now.
- Do not treat experiment-only data as fully confirmed product policy unless
  user/repo evidence confirms it.

## 7. Current Hypotheses

- all_required parallel should become the default direction.
- adaptive concurrency is not preferred unless all_required shows concrete
  problems.
- further concurrency experiments have low marginal value right now.
- router may still miss possible information sources.
- a broad shallow probe may be useful before deep worker research.
- worker source limits may be too restrictive.
- future productization should support multiple providers.
- hidden validator runner is a major future milestone.

## 8. Current Known Evidence

All-parallel stress:

- baseline concurrency `3`: completedRate `0.8571`, failedRate `0.1429`,
  medianDurationMs `522481`, averageCoverageScore `99`.
- all_parallel concurrency `7`: completedRate `1`, failedRate `0`,
  medianDurationMs `115798`, averageCoverageScore `100`.
- decision: `durationImprovement=0.7784`, `coverageDelta=1`,
  `stabilityRegression=false`, `recommendation=all_required_parallel_viable`.

Retry/progress improvements:

- transient network errors were classified separately and retried.
- no_artifact_progress and no_semantic_progress were not dominant in latest
  reports.

App subagents:

- legacy tests indicated App subagents did not reliably spawn under strict
  programmatic requirements.

Hidden validator:

- earlier no-code plan described the existing validation layer as scaffold or
  not_configured and needing a real runner contract.

Similar projects:

- Useful references include OpenAI Codex cloud/App, Claude Code subagents,
  OpenHands, SWE-agent, Microsoft Agent Framework, LangGraph, OpenAI Agents SDK,
  CrewAI, LlamaIndex, Pydantic AI, and Temporal-style durable execution.

## 9. User Preferences And Working Style

- ChatGPT Web should act as planner, architecture reviewer, experiment
  interpreter, Codex report reviewer, and handoff maintainer.
- Codex should act as implementer, tester, report writer, and repo updater.
- Chinese is preferred unless asked otherwise.
- Aggressive coverage is preferred over cost minimization.
- all_required parallel is preferred over conservative/adaptive defaults.
- Keyword/rule-based primary classification is disliked.
- Commit/push permission is task-specific and should not be blind.

## 10. Durable Handoff Rules

- New ChatGPT conversations should not depend on old chat history.
- They should read repo handoff files first.
- Codex reports should include summary, commands, verification, files changed,
  plan path, current state path, output path, and safety checklist.
- Code, documentation, or configuration changes should update
  `CURRENT_STATE.md` and `CODEX_REPORT.md`.
- Stale current state should be flagged.
- Decisions should be labeled confirmed, tentative, obsolete, or
  experiment-only.
- AGENTS.md should point to durable context, not contain long history.
- Exhaustive coverage and all_required direction should be documented.

## 11. Current Repo Files Probably Missed Before Backfill

- `ai/context/PROJECT_CONTEXT.md`: core goals, exhaustive search,
  executor/validator loop, parallel execution, SDK threads, App subagent status,
  all_required direction, multi-provider flexibility.
- `ai/context/REVIEW_PROTOCOL.md`: ChatGPT role, Codex role, review sources,
  stale-state handling, safety review.
- `ai/context/CURRENT_STATE.md`: current decisions, latest evidence, current
  priorities, next action.
- `ai/decisions/DECISION_LOG.md`: durable decisions and statuses.
- `ai/reports/CODEX_REPORT.md`: allow no next question, commit/push status, and
  user-visible decision needed.
- `ai/plans/TEMPLATE.md`: user intent alignment, stop conditions,
  commit/push policy, handoff updates.
- `AGENTS.md`: short pointers to durable context.
- `.github/pull_request_template.md`: plan/report/state links, verification,
  generated artifact check, experiment-only/default-policy note.

## 12. Open Questions

- Is exhaustive coverage mode fully implemented?
- Has all_required become code default, or only a confirmed direction?
- Should worker source limits become at least 3-5 or elastic?
- Does orchestrator-level source ranking/dedupe exist?
- Should broad shallow probing be next?
- What is the exact hidden validator runner status?
- How should multi-provider support start?
- What conditions allow Codex to auto commit/push?
- Which diagnostics JSON outputs should remain untracked vs summarized?

## 13. TODO List

High priority:

- Confirm or implement exhaustive coverage mode.
- Confirm or implement all_required as default strict research direction.
- Adjust worker source return policy.
- Clarify SDK strict runner default behavior with all_required.
- Ensure new ChatGPT conversations can operate from repo context only.

Medium priority:

- Broad shallow probe.
- Hidden validator runner.
- Run state machine.

Low priority:

- Computed confidence.
- App subagent fallback system.
- Multi-provider abstraction.
- UI/dashboard.
- Full large concurrency matrix.
