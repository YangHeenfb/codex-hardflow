# Current State

## Current Snapshot: Status File Policy Update

Last updated: 2026-06-18

Branch:

- `main`
- Current HEAD: `5239ede Fix router excluded bucket handling`

Current objective:

- Persist the repository rule that Codex updates durable state files after every
  code, documentation, or configuration change.
- Remove the old required next-question handoff policy and existing stored
  question blocks from active project handoff files.

Files changed in this update:

- `AGENTS.md`
- `ai/README.md`
- `ai/plans/TEMPLATE.md`
- `ai/decisions/DECISION_LOG.md`
- `.github/pull_request_template.md`
- `ai/context/REVIEW_PROTOCOL.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.en.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.zh.md`
- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`
- `ai/plans/2026-06-11-all-parallel-stress.md`

Current rule:

- After every code, documentation, or configuration change, update
  `ai/context/CURRENT_STATE.md` and `ai/reports/CODEX_REPORT.md`.
- Status updates should record the change summary, verification status, and any
  current risks or open follow-up.

Verification for this docs-only update:

- Text search confirmed the old next-question requirement strings no longer
  appear in active project handoff files.
- No npm build/test/verify run yet for this documentation-only edit.

Safety / scope notes:

- No product source code was changed.
- No SDK runner, daemon/job, hidden validator, computed confidence, or
  diagnostics experiment work was done.
- No global files were modified and no `install-global` was run.

## Current Snapshot

Last updated: 2026-06-18

Branch:

- `main`
- Current HEAD: `5239ede Fix router excluded bucket handling`
- Remote state: local `main` is aligned with `origin/main` before this status-file update.

Current objective:

- Bring the durable handoff state files back in sync with the recent
  codex-hardflow work around `ask`, output localization/progress rendering, and
  router excluded-bucket handling.

Recent implementation milestones now on `main`:

- `275bb57 Implement synchronous hardflow ask CLI`
  - Added `codex-hardflow ask` as a synchronous CLI path independent of Codex
    App hook/Stop-gate foreground behavior.
  - `ask` routes the question, runs strict programmatic research for research
    routes, waits for completion, and synthesizes from run-owned
    `research_report.json` / `EvidenceLedger`.
  - Added `--json`, `--async`, `--from-run`, provider options, coverage/parallel
    options, source limits, and `jobs wait`.
- `5d59a5c Refactor ask progress and answer synthesis`
  - Added output language policy and localized ask answer synthesis.
  - Chinese/Japanese/Spanish and other common-language prompts now keep the
    final answer headings/explanations in the user-requested or dominant user
    language.
  - Added ask progress renderer with `auto`, `quiet`, `verbose`, and `json`
    modes, duplicate suppression, TTY single-line updates, and source-list
    output controls.
- `5239ede Fix router excluded bucket handling`
  - Tightened router/coverage behavior for excluded buckets.
  - Added tests around ask output and router/coverage excluded-bucket handling.
  - `RouterOutput.sourceBuckets[*].status` now accepts `excluded` in addition
    to `required`, `possible`, and `not_needed`.
  - `routerNormalize` preserves `excluded` and normalizes common status
    synonyms such as `optional` / `maybe` -> `possible`,
    `recommended` / `must_search` -> `required`, `not_applicable` /
    `irrelevant` -> `not_needed`, and `unavailable` / `forbidden` /
    `private_unavailable` / `skipped_for_safety` -> `excluded`.
  - Invalid router bucket statuses now fail safe to `required` with a
    normalization warning instead of dropping the bucket.
  - Router prompt and repair prompt now explicitly list allowed
    `sourceBuckets.status` values and state that `searched_but_no_signal` is a
    research result state, not a RouterOutput status.
  - CoveragePolicy now maps router `excluded` buckets into
    `CoveragePlan.excludedBuckets` and keeps them out of `requiredBucketCount`.
  - `ask` router-failure output is localized for Chinese prompts with
    `路由失败:` and `详情:` while preserving the raw technical failure in
    `failureReason`.
  - The ask progress renderer now finishes open TTY carriage-return status
    lines with a newline so shell prompts or follow-up commands do not glue to
    the last progress line after failures.

Current verification result:

- `npm run build`: passed on 2026-06-18.
- `npm test`: passed on 2026-06-18, 30 test files and 260 tests.
- `npm run verify`: passed on 2026-06-18; `verify:self` reported
  `packDryRunPassed=true`, `forbidden=[]`, global wrapper fresh, and wrapper
  target pointing at `/Users/yang/Documents/subagents/bin/codex-hardflow`.
- `npm pack --dry-run --json`: passed on 2026-06-18, package entry count `210`.

Safety / scope notes:

- No SDK runner changes were made for the ask output/localization work.
- No daemon/job architecture change was made in the output-localization step.
- No computed confidence work was done.
- No hidden validator runner work was done.
- No large diagnostics experiment was run.
- No global files were modified and no `install-global` was run.
- Because the global wrapper already points at this repo, normal local use only
  needs the built `dist/` output; hook trust does not need to be refreshed for
  CLI-output-only changes.

Current working tree after this update:

- Expected dirty files: this `ai/context/CURRENT_STATE.md` and
  `ai/reports/CODEX_REPORT.md` status backfill only.
- Do not stage unrelated changes if another process modifies the repo.

Next action:

- If the user asks, commit and push only these handoff/status-file updates.
- Otherwise, continue implementation from current `main`; the old all-parallel
  plan remains historical context, not the active task plan.

## Last Updated

2026-06-13

## Branch

`agent/2026-06-11-chatgpt-codex-handoff`

## Current Objective

Commit and push the current hardflow trigger-policy implementation work.

The current product changes make automatic UserPromptSubmit/Router research use
strict programmatic SDK execution by default instead of App handoff/subagent
prompting. They also add ResearchRequest plumbing for implementation turns that
discover external evidence needs after initial routing.

## Plan

No separate active plan file was created for this commit. The working set is a
coherent implementation milestone around router-required prompt handling,
strict programmatic research defaults, and ResearchRequest gates.

New planning and review conversations should read:

- `ai/context/PROJECT_CONTEXT.md`
- `ai/context/REVIEW_PROTOCOL.md`
- `ai/context/CURRENT_STATE.md`
- `ai/decisions/DECISION_LOG.md`
- the relevant plan under `ai/plans/`
- `ai/reports/CODEX_REPORT.md`

## Current Implementation Status

Implemented in the current working tree before commit:

- `UserPromptSubmit` creates router-required markers for every non-empty prompt
  and injects explicit route/research CLI commands.
- `route=research` now defaults to `strict_programmatic`,
  `coverageMode=exhaustive`, and `parallelPolicy=all_required`.
- App subagents are documented and prompted as best-effort only, not the strict
  coverage mechanism.
- `codex-hardflow research request` subcommands were added for create, list,
  run, and resolve.
- Stop gate checks now block automatic research routes unless a matching strict
  programmatic report satisfies the run-owned evidence requirements.
- Stop gate blocks unresolved or failed blocking ResearchRequests and executor
  manifests that claim external research is needed without linked strict
  research.
- README, source coverage protocol, global AGENTS text, and skill text were
  updated to match the new trigger-policy direction.

Verification:

- `npm run verify`: passed on 2026-06-13 at 01:34 CST.
- Build passed.
- Vitest passed: 24 test files, 185 tests.
- Self verification and pack dry-run check passed with `forbidden: []`.

## Legacy Backfill Status

Created durable context files from the legacy ChatGPT planning summary:

- `ai/context/PROJECT_CONTEXT.md`
- `ai/context/REVIEW_PROTOCOL.md`
- `ai/decisions/DECISION_LOG.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.en.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.zh.md`

Legacy claims were split into confirmed decisions, hypotheses, planned work,
experiment-only evidence, and open questions where practical.

## Previous Experiment Preconditions Result

Passed:

- `npm run build`: passed.
- `npm test`: passed, 22 test files and 168 tests.
- `npm run verify`: passed, including pack check with `forbidden: []`; global wrapper was fresh and pointed to the current source root.
- `npm pack --dry-run --json`: passed, package entry count 162.

No global files were modified.

## Previous Experiment Command Used

`all` is not supported by the current numeric CSV parser for `--concurrency-levels`, so numeric `7` was used for the all-parallel variant.

```sh
codex-hardflow diagnostics sdk-concurrency \
  --task "Compare current practical approaches for hidden validation in AI coding agents." \
  --buckets official_docs,github,academic,security,package_registry,codex_default_discovery,competitors \
  --concurrency-levels 3,7 \
  --repeats 2 \
  --max-sources-per-worker 2 \
  --hard-timeout-ms 1800000 \
  --global-budget-ms 3600000 \
  --workdir-root /tmp/codex-hardflow-diagnostics-all-parallel \
  --output .agent/reports/diagnostics/sdk-all-parallel-stress.json \
  --execute \
  --real-sdk \
  --no-randomize
```

## Previous Experiment Output Path

`.agent/reports/diagnostics/sdk-all-parallel-stress.json`

Experiment ID:

`diag-2026-06-11T12-22-45-064Z-6dbb5de7`

## Previous Real SDK Run

Completed. Four runs were executed: two baseline runs at concurrency `3`, and two all-parallel runs at concurrency `7`.

## Previous Experiment Isolation Status

Passed:

- `contaminationDetected=false`.
- Each variant used an isolated repo and home directory under `/tmp/codex-hardflow-diagnostics-all-parallel`.
- Each variant had an explicit independent `runId`.
- Each variant set `CODEX_HARDFLOW_HOME` to its isolated home directory.
- Plan entries included explicit `--run-id`.
- Coverage eval args included explicit `--run-id`.
- Plan isolation fields disabled latest/current shortcuts.
- No cross-variant SDK thread reuse was detected.
- All run reports used `strict_programmatic` / `sdk_threads`.
- App subagents were `not_applicable`.
- No manual fallback or AGENTS/skill fallback was recorded.

## Previous Baseline Summary

`maxConcurrentBuckets=3`, two repeats, 14 total workers:

- completedRate: `0.8571`
- timeoutRate: `0`
- timeoutRateExcludingTransient: `0`
- failedRate: `0.1429`
- invalidJsonRate: `0`
- medianDurationMs: `522481`
- p90DurationMs: `563682`
- medianTimeToFirstEvidenceMs: `0`
- averageSourcesFound: `1.7143`
- averageCoverageScore: `99`
- retrySuccessRate: `1`
- transientNetworkErrorRate: `0.2143`
- noActivityProgressRate: `0.1429`
- noArtifactProgressRate: `0.0714`
- noSemanticProgressRate: `0`
- checkpointNudgeSuccessRate: `0`

Baseline failures:

- repeat 1: `security` failed with `no_activity_progress`.
- repeat 2: `academic` failed with `no_activity_progress`.

## Previous All-Parallel Summary

`maxConcurrentBuckets=7`, two repeats, 14 total workers:

- completedRate: `1`
- timeoutRate: `0`
- timeoutRateExcludingTransient: `0`
- failedRate: `0`
- invalidJsonRate: `0`
- medianDurationMs: `115798`
- p90DurationMs: `131769`
- medianTimeToFirstEvidenceMs: `0`
- averageSourcesFound: `2`
- averageCoverageScore: `100`
- retrySuccessRate: `1`
- transientNetworkErrorRate: `0.2857`
- noActivityProgressRate: `0`
- noArtifactProgressRate: `0`
- noSemanticProgressRate: `0`
- checkpointNudgeSuccessRate: `0`

## All-Parallel Experiment Status

Decision criteria result:

- `durationImprovement=0.7784`
- `coverageDelta=1`
- `stabilityRegression=false`
- `recommendation=all_required_parallel_viable`

The all-parallel stress experiment has been completed and remains an
experiment-only finding unless later confirmed by user decision and repo
implementation evidence. It supports all-required parallelism as promising, but
does not prove that all-required is already the code default.

## Known Anomalies

- The sample is intentionally small: two repeats per variant.
- The diagnostics summary's built-in `conclusion` remains generic and still notes transient noise, but the explicit experiment decision logic passes for all-parallel viability.
- Existing product source/test changes are now treated as the current
  router/ResearchRequest implementation milestone to commit and push.
- The diagnostics JSON is under `.agent/reports/diagnostics/` and was not added to git.
- Current branch name is `agent/2026-06-11-chatgpt-codex-handoff`, which is stale for this backfill task but still the active branch.
- Existing handoff files already contain uncommitted diagnostics experiment context.
- Legacy context was supplied by old ChatGPT Web planning history and should not be treated as verified fact by itself.

## Current State Update: Job/Daemon Automatic Trigger Architecture

Date: 2026-06-17

Branch:

- `main`

Current objective:

- Commit and push the implementation that changes codex-hardflow automatic
  triggering from hook-synchronous route/research execution to a short hook plus
  background job/daemon model.

Implementation status:

- `UserPromptSubmit` now creates a marker, writes `hook_input.json`, and enqueues
  `.agent/hardflow/jobs/<runId>.json`.
- `UserPromptSubmit` no longer runs Codex CLI/SDK route or strict research
  synchronously.
- `Stop` hook now checks job status and blocks while jobs are
  `pending`, `routing`, or `researching`.
- `Stop` hook blocks failed/cancelled jobs and only proceeds to existing
  router/report/evidence gates for completed jobs.
- Added job store/schema, daemon runner, router provider abstraction, and CLI
  commands:
  - `codex-hardflow daemon run|status|stop`
  - `codex-hardflow jobs list|show|run-once|run-pending`
- Daemon-local Codex execution uses isolated
  `.agent/hardflow/runs/<runId>/codex-home` and internal hardflow env guards.

Verification:

- `npm run build`: passed.
- `npm test`: passed, 27 test files and 226 tests.
- `npm run verify`: passed.
- `npm pack --dry-run --json`: passed.

Safety notes:

- No OpenAI API router was implemented.
- No computed confidence work was done.
- No hidden validator runner work was done.
- No large diagnostics experiment was run.
- No global files were modified.
- `.agent/hardflow/` runtime output from tests was removed and not staged.

Next action:

- Commit and push the job/daemon architecture changes on `main`.

## Current State Update: Queue, Scope, And Progress Snapshot

Date: 2026-06-17

Branch:

- `main`

Current objective:

- Commit and push the follow-up fix that separates daemon job-level concurrency
  from SDK worker-level concurrency, exposes queue/progress state, and makes
  CoveragePlan selection depend on RouterOutput `researchScope` /
  `evidenceNeed` rather than hardcoded prompt text.

Implementation status:

- Added RouterOutput fields: `researchScope`, `evidenceNeed`,
  `localDiagnosisRequired`, `externalResearchRequired`, and
  `exhaustiveCoverageRequired`.
- Router traces, Source Coverage Matrix, CoveragePlan, and ResearchReport now
  carry `researchScope` / `evidenceNeed`.
- Coverage policy now maps:
  - `local_diagnostic` to `local_repo` only.
  - `local_plus_external` to `local_repo` plus selected external buckets.
  - `external_exhaustive` to the full external exhaustive bucket set.
  - `implementation_support` to local-first support with ResearchRequest later
    if external evidence becomes necessary.
- Daemon config now distinguishes user-level job slots from global SDK worker
  capacity: `maxConcurrentJobs`, foreground/background job limits, and
  `maxGlobalSdkWorkers`.
- Job records now include priority, queue position, estimated start delay,
  foreground/current-turn flags, requested worker count, and allocated worker
  count.
- Stop hook pending/running blocks now include a structured
  `progressSnapshot` with queue position, elapsed time, scope, bucket counts,
  coverage-so-far, and current worker status.

Verification:

- `npm run build`: passed.
- `npm test`: passed, 28 test files and 233 tests.
- `npm run verify`: passed.
- `npm pack --dry-run --json`: passed.

Safety notes:

- No SDK runner concurrency strategy was changed.
- No computed confidence work was done.
- No hidden validator runner work was done.
- No large diagnostics experiment was run.
- No global files were modified.

Next action:

- Commit and push the queue/scope/progress snapshot fix on `main`.
