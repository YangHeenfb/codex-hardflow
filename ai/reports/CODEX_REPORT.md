# Codex Report

## Task

Run a real isolated codex-hardflow diagnostics experiment: all-parallel stress test for required external research buckets.

## Plan Path

`ai/plans/2026-06-11-all-parallel-stress.md`

## Current State Path

`ai/context/CURRENT_STATE.md`

## Output Path

`.agent/reports/diagnostics/sdk-all-parallel-stress.json`

## Summary

The isolated real SDK diagnostics experiment completed. It compared baseline concurrency `3` against all required external research buckets in parallel, represented by numeric concurrency `7`.

The all-parallel variant was much faster in this small experiment and had no stability regression under the requested decision criteria.

## Commands Run

Workflow and scouting:

- `sed -n '1,240p' AGENTS.md`
- `sed -n '1,240p' ai/README.md`
- `sed -n '1,260p' ai/plans/TEMPLATE.md`
- `sed -n '1,260p' ai/context/CURRENT_STATE.md`
- `sed -n '1,260p' ai/reports/CODEX_REPORT.md`
- `sed -n '1,220p' /Users/yang/.agents/skills/codex-hardflow/SKILL.md`
- `git status --short`
- `git branch --show-current`
- `rg -n "concurrency-levels|concurrencyLevels|parse.*concurrency|all" src/diagnostics src/cli.ts src/flagParser.ts tests -g '*.ts'`

Preflight:

- `codex-hardflow diagnostics sdk-concurrency --task "Compare current practical approaches for hidden validation in AI coding agents." --buckets official_docs,github,academic,security,package_registry,codex_default_discovery,competitors --concurrency-levels 3,7 --repeats 2 --max-sources-per-worker 2 --hard-timeout-ms 1800000 --global-budget-ms 3600000 --workdir-root /tmp/codex-hardflow-diagnostics-all-parallel-preflight --output .agent/reports/diagnostics/sdk-all-parallel-stress-preflight.json --dry-run --no-randomize`

Real SDK experiment:

- `codex-hardflow diagnostics sdk-concurrency --task "Compare current practical approaches for hidden validation in AI coding agents." --buckets official_docs,github,academic,security,package_registry,codex_default_discovery,competitors --concurrency-levels 3,7 --repeats 2 --max-sources-per-worker 2 --hard-timeout-ms 1800000 --global-budget-ms 3600000 --workdir-root /tmp/codex-hardflow-diagnostics-all-parallel --output .agent/reports/diagnostics/sdk-all-parallel-stress.json --execute --real-sdk --no-randomize`

Post-run checks:

- `jq '{experimentId, contaminationDetected, contaminationReasons, runCount, outputPath, workdirRoot, summary:.summary}' .agent/reports/diagnostics/sdk-all-parallel-stress.json`
- `jq -r '.runResults[] | [.runId,.concurrencyLevel,.repeatIndex,.durationMs,.coverage_score,.completedBucketCount,.failedBucketCount,.timeoutBucketCount,.invalidJsonCount,.sourceCount,.noActivityProgressRate,.noArtifactProgressRate,.transientNetworkErrorRate] | @tsv' .agent/reports/diagnostics/sdk-all-parallel-stress.json`
- Checked isolated `research_report.json` files for runner/evidence modes and fallback state.
- Checked thread IDs for cross-variant reuse.
- Checked experiment plan for explicit `--run-id`, coverage eval `--run-id`, isolated repo/home, and `CODEX_HARDFLOW_HOME`.
- Checked diagnostics output size and `git status --short`.

## Verification Commands And Result

- `npm run build`: passed.
- `npm test`: passed, 22 test files and 168 tests.
- `npm run verify`: passed. The built-in pack check had `forbidden: []`; the global wrapper was fresh and pointed to the current source root.
- `npm pack --dry-run --json`: passed, package entry count 162.

## Experiment Result Summary

- experimentId: `diag-2026-06-11T12-22-45-064Z-6dbb5de7`
- output path: `.agent/reports/diagnostics/sdk-all-parallel-stress.json`
- workdir root: `/tmp/codex-hardflow-diagnostics-all-parallel`
- runCount: `4`
- contaminationDetected: `false`

Run summary:

| Variant | Concurrency | Repeat | DurationMs | Completed | Failed | Timeout | Invalid JSON | Coverage | Sources |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 3 | 1 | 563682 | 6 | 1 | 0 | 0 | 99 | 12 |
| baseline | 3 | 2 | 481279 | 6 | 1 | 0 | 0 | 99 | 12 |
| all_parallel | 7 | 1 | 131769 | 7 | 0 | 0 | 0 | 100 | 14 |
| all_parallel | 7 | 2 | 99826 | 7 | 0 | 0 | 0 | 100 | 14 |

## Metrics Summary

Baseline, `maxConcurrentBuckets=3`:

- completedRate: `0.8571`
- timeoutRate: `0`
- timeoutRateExcludingTransient: `0`
- failedRate: `0.1429`
- invalidJsonRate: `0`
- retrySuccessRate: `1`
- transientNetworkErrorRate: `0.2143`
- noActivityProgressRate: `0.1429`
- noArtifactProgressRate: `0.0714`
- noSemanticProgressRate: `0`
- checkpointNudgeSuccessRate: `0`
- medianDurationMs: `522481`
- p90DurationMs: `563682`
- medianTimeToFirstEvidenceMs: `0`
- averageSourcesFound: `1.7143`
- averageCoverageScore: `99`

All_parallel, `maxConcurrentBuckets=7`:

- completedRate: `1`
- timeoutRate: `0`
- timeoutRateExcludingTransient: `0`
- failedRate: `0`
- invalidJsonRate: `0`
- retrySuccessRate: `1`
- transientNetworkErrorRate: `0.2857`
- noActivityProgressRate: `0`
- noArtifactProgressRate: `0`
- noSemanticProgressRate: `0`
- checkpointNudgeSuccessRate: `0`
- medianDurationMs: `115798`
- p90DurationMs: `131769`
- medianTimeToFirstEvidenceMs: `0`
- averageSourcesFound: `2`
- averageCoverageScore: `100`

## Decision Logic Result

Computed values:

- `durationImprovement=0.7784`
- `coverageDelta=1`
- `stabilityRegression=false`
- `recommendation=all_required_parallel_viable`

The all-parallel variant met the requested viability criteria:

- duration improvement was greater than `0.20`.
- stability regression was false.
- coverage delta was greater than `-5`.

This result supports all-required parallelism as worth further testing. It does not by itself make all-parallel default-ready because the sample is only two repeats per variant.

## Safety Checklist

- [x] Did not auto commit.
- [x] Did not push.
- [x] Did not modify global files.
- [x] Did not use `--dangerously-bypass-hook-trust`.
- [x] Did not run full `1,2,3,6 x 3` matrix.
- [x] Did not run prompt-width diagnostic.
- [x] Did not run hidden validator work.
- [x] Did not do computed confidence.
- [x] Did not do hidden validator runner.
- [x] Did not modify App subagents.
- [x] Did not add community bucket.
- [x] Did not add `local_repo`.
- [x] Did not use latest/current report as an input shortcut.
- [x] Did not stage unrelated dirty working tree changes.
- [x] Updated `ai/context/CURRENT_STATE.md`.
- [x] Updated `ai/reports/CODEX_REPORT.md`.
- [x] Created `ai/plans/2026-06-11-all-parallel-stress.md`.

## Deviations From Plan

- Literal `all` was not supported by the existing numeric parser, so the experiment used numeric `7` as the all-required equivalent. No parser support was implemented.
- The diagnostics JSON output was not committed. It is under `.agent/reports/diagnostics/` and was not shown in `git status`.

## Risks And Uncertainties

- This was intentionally not a full matrix; it used two repeats per variant.
- Real SDK behavior can vary with network, service-side caching, and temporal ordering.
- Baseline had two no-activity failures: `security` in repeat 1 and `academic` in repeat 2.
- The diagnostics command's built-in generic conclusion still says transient noise limits concurrency attribution, but the explicit experiment decision logic passed for all-parallel viability.
- Existing uncommitted product source/test changes remain in the working tree and are unrelated to this handoff update.

## Next ChatGPT Question

Please review the all-parallel stress experiment using:

- `ai/plans/2026-06-11-all-parallel-stress.md`
- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`
- `.agent/reports/diagnostics/sdk-all-parallel-stress.json` if available
- the command output summary

Questions:

1. Did the experiment follow the intended design?
2. Is all_required parallel viable based on the decision criteria?
3. Is the result strong enough to justify a larger matrix?
4. Should the next diagnostic test prompt width, bucket difficulty, or adaptive concurrency?
5. Is any code change needed, or should this remain an experiment-only finding?

## Report Entry: Legacy Context Backfill

### Task

Convert the legacy ChatGPT Web planning summary into durable repo context files
for future ChatGPT-Codex handoffs.

### Files Changed

- `AGENTS.md`
- `.github/pull_request_template.md`
- `ai/context/PROJECT_CONTEXT.md`
- `ai/context/REVIEW_PROTOCOL.md`
- `ai/context/CURRENT_STATE.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.en.md`
- `ai/context/LEGACY_CONTEXT_BACKFILL.zh.md`
- `ai/decisions/DECISION_LOG.md`
- `ai/reports/CODEX_REPORT.md`
- `ai/plans/TEMPLATE.md`

### Verification Commands

- `git diff --check`: passed.
- `git status --short`: reviewed; unrelated product source/test/docs changes are present in the working tree and were not staged.
- `wc -l AGENTS.md ai/README.md ai/context/PROJECT_CONTEXT.md ai/context/REVIEW_PROTOCOL.md ai/context/CURRENT_STATE.md ai/context/LEGACY_CONTEXT_BACKFILL.md ai/decisions/DECISION_LOG.md ai/reports/CODEX_REPORT.md ai/plans/TEMPLATE.md .github/pull_request_template.md`: passed line-count sanity check.
- Hidden/bidirectional Unicode control character scan for U+202A through U+202E, U+2066 through U+2069, U+200B, U+200C, U+200D, and U+FEFF: no matches found.

### Safety Checklist

- [x] Documentation/workflow context only.
- [x] Product source files were not modified.
- [x] Tests were not modified.
- [x] No global files were modified.
- [x] No SDK experiments or diagnostics were run.
- [x] User explicitly requested commit and push after validation.
- [x] Scoped staging is limited to handoff/backfill files.
- [x] No secrets, tokens, `.env` contents, raw logs, or sensitive personal data were added.

### What Was Treated As Fact

- Repo-observed facts from current files, such as package manager, current handoff file paths, branch name, and existing report contents.
- User-confirmed preferences and decisions explicitly labeled as confirmed in the legacy pack.
- The all-parallel stress numbers already present in current state/report files.

### What Was Treated As Hypothesis

- Whether exhaustive/all-required behavior is fully implemented as code default.
- Exact worker source count policy.
- Broad shallow probe priority.
- Multi-provider abstraction design.
- Hidden validator runner implementation status.
- How broadly Codex may auto commit/push in future tasks.

### What Was Intentionally Not Changed

- Product source code.
- Tests.
- Package files.
- Global files.
- Raw diagnostics JSON.
- Private validation artifacts or hidden cases.

### Next ChatGPT Question

Please review the legacy context backfill using:

- uploaded files and the current PR or branch diff first;
- `ai/context/PROJECT_CONTEXT.md`;
- `ai/context/REVIEW_PROTOCOL.md`;
- `ai/context/CURRENT_STATE.md`;
- `ai/decisions/DECISION_LOG.md`;
- `ai/reports/CODEX_REPORT.md`;
- old chat memory only as unverified context.

Known anomalies:

- The branch name is stale for this backfill task.
- Product source/test dirty changes exist in the working tree and are unrelated.
- Legacy context claims are migrated summaries, not automatically verified facts.
- The all-parallel stress result is experiment-only unless later confirmed.

Expected output format:

- Review findings first.
- Then say whether the backfilled context is sufficient for a fresh ChatGPT planning conversation.
- Then list missing or risky context.
- Then provide the next Codex-ready prompt.

Next Codex prompt request:

- Please provide the exact next prompt the user should give Codex.

## Report Entry: Router-Required Strict Research And ResearchRequests

### Task

Commit and push the current implementation milestone that moves automatic
UserPromptSubmit/Router research away from App handoff/subagent prompting and
toward strict programmatic SDK execution.

### Files Changed

- `README.md`
- `docs/source-coverage-protocol.md`
- `src/cli.ts`
- `src/config.ts`
- `src/flagParser.ts`
- `src/hookState.ts`
- `src/hooks/stopValidationGate.ts`
- `src/hooks/userPromptSubmit.ts`
- `src/paths.ts`
- `src/research/researchRequest.ts`
- `src/researchOrchestrator.ts`
- `src/router/routerPrompt.ts`
- `src/schemas.ts`
- `src/triggerPolicy.ts`
- `tests/flagParser.test.ts`
- `tests/hookState.test.ts`
- `tests/researchRequest.test.ts`
- `tests/researchRunner.test.ts`
- `tests/triggerAudit.test.ts`
- `tests/triggerPolicy.test.ts`
- `tests/userPromptSubmit.test.ts`
- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`

### Summary

- `UserPromptSubmit` now marks every non-empty prompt as router-required and
  injects exact CLI commands for route preflight and strict research.
- `route=research` defaults to `strict_programmatic`,
  `coverageMode=exhaustive`, and `parallelPolicy=all_required`.
- App subagents are retained only as best-effort/manual downgrade workers, not
  as the strict coverage mechanism.
- Added `codex-hardflow research request` create/list/run/resolve plumbing for
  implementation turns that discover external evidence needs.
- Stop gate now enforces strict research reports for automatic research routes
  and blocks unresolved or failed blocking ResearchRequests.
- Protocol docs, README, generated global AGENTS text, and generated skill text
  were updated to match the stricter trigger-policy direction.

### Verification Commands

- `npm run verify`: passed on 2026-06-13 01:34 CST.
  - `npm run build`: passed.
  - `npm test`: passed, 24 test files and 185 tests.
  - `node dist/cli.js verify:self`: passed; pack dry-run check had
    `forbidden: []`, global wrapper was fresh, and the wrapper pointed to the
    current source root.

### Safety Checklist

- [x] User explicitly requested commit and push.
- [x] Reviewed `git status --short` before staging.
- [x] Reviewed product and test diffs before staging.
- [x] Used a single coherent staging scope for router/research-request changes.
- [x] Updated `ai/context/CURRENT_STATE.md`.
- [x] Updated `ai/reports/CODEX_REPORT.md`.
- [x] No `.env`, secrets, raw traces, huge logs, hidden fixtures, or private
  validation artifacts were added.

### Known Anomalies

- Branch name remains stale: `agent/2026-06-11-chatgpt-codex-handoff`.
- No new plan file was created for this implementation milestone.
- Existing `.agent/reports/diagnostics/` JSON outputs remain untracked.
- The Stop gate still blocks router-required markers once for a missing router
  trace before allowing with a failure notice; this is documented test coverage,
  but may be stricter in a later change if the user wants hard blocking.

### Next ChatGPT Question

Please review the router-required strict research and ResearchRequest milestone
using:

- uploaded files, the current PR, and the current branch diff first;
- `ai/context/CURRENT_STATE.md`;
- `ai/context/PROJECT_CONTEXT.md`;
- `ai/context/REVIEW_PROTOCOL.md`;
- `ai/decisions/DECISION_LOG.md`;
- `ai/reports/CODEX_REPORT.md`;
- old chat memory only as unverified context.

Known anomalies:

- Branch name is stale for this implementation milestone.
- No separate plan file exists for this milestone.
- Existing diagnostics artifacts under `.agent/reports/diagnostics/` are not
  committed.
- The router-required missing-trace Stop gate currently blocks once, then allows
  with a notice.

Expected output format:

- Review findings first.
- Then state whether the milestone is coherent and safe to merge after PR
  review.
- Then list missing tests, docs, or durable context.
- Then provide the next Codex-ready prompt.

Next Codex prompt request:

- Please provide the exact next prompt the user should give Codex to address
  any PR review findings or proceed toward merge.

## Report Entry: Job/Daemon Automatic Trigger Architecture

### Task

Change codex-hardflow automatic triggering so hooks do not synchronously run
Codex CLI/SDK route or long strict research. UserPromptSubmit should enqueue a
HardFlow job, and a daemon/background runner should process route and strict
research with isolated Codex state.

### Files Changed

- `src/cli.ts`
- `src/config.ts`
- `src/hooks/stopValidationGate.ts`
- `src/hooks/userPromptSubmit.ts`
- `src/internalEnv.ts`
- `src/paths.ts`
- `src/researchOrchestrator.ts`
- `src/daemon/daemon.ts`
- `src/daemon/jobRunner.ts`
- `src/jobs/jobSchema.ts`
- `src/jobs/jobStore.ts`
- `src/router/providers/codexCli.ts`
- `src/router/providers/index.ts`
- `tests/hookState.test.ts`
- `tests/jobDaemon.test.ts`
- `tests/triggerAudit.test.ts`
- `tests/userPromptSubmit.test.ts`
- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`

### Summary

- Added persistent job files at `.agent/hardflow/jobs/<runId>.json`.
- Added daemon/job CLI commands: `daemon run|status|stop` and
  `jobs list|show|run-once|run-pending`.
- Refactored `UserPromptSubmit` to enqueue a job only.
- Refactored `Stop` hook to check job state and avoid long-running route or
  strict research work.
- Added isolated Codex home handling for daemon-local Codex CLI/SDK execution.
- Added router provider abstraction with `codex_cli` default, `codex_sdk`, and
  `mock`; OpenAI/local providers remain placeholders.
- Kept existing strict research execution through the SDK runner, without
  changing coverage policy or concurrency defaults.

### Verification Commands

- `npm run build`: passed.
- `npm test`: passed, 27 test files and 226 tests.
- `npm run verify`: passed.
- `npm pack --dry-run --json`: passed.

### Safety Checklist

- [x] Did not implement OpenAI API router.
- [x] Did not do computed confidence.
- [x] Did not do hidden validator runner work.
- [x] Did not run large diagnostics experiments.
- [x] Did not modify global files.
- [x] Removed untracked `.agent/hardflow/` runtime output before staging.
- [x] Updated `ai/context/CURRENT_STATE.md`.
- [x] Updated `ai/reports/CODEX_REPORT.md`.

### Risks And Follow-Ups

- Daemon lifecycle is intentionally minimal; production supervision or launchd
  integration can be added later.
- `codex_cli` provider depends on local `codex exec` availability and trust
  behavior. Tests use mock providers for deterministic coverage.
- Future router providers can add `openai_structured_output` or local model
  routing without changing hook semantics.

### Next ChatGPT Question

Please review the job/daemon automatic trigger architecture using:

- uploaded files, the current `main` diff, and current state files first;
- `ai/context/CURRENT_STATE.md`;
- `ai/context/PROJECT_CONTEXT.md`;
- `ai/context/REVIEW_PROTOCOL.md`;
- `ai/reports/CODEX_REPORT.md`;
- old chat memory only as unverified context.

Known anomalies:

- Older entries in current-state/report mention stale branch names from prior
  handoff work; the current commit target is `main`.
- Daemon supervision is minimal by design.
- No global install was run for this change.

Expected output format:

- Review findings first.
- Then state whether the job/daemon architecture satisfies the intended
  fail-closed trigger design.
- Then list missing tests, docs, or operational gaps.
- Then provide the next Codex-ready prompt.

Next Codex prompt request:

- Please provide the exact next prompt the user should give Codex to address any
  review findings or proceed with the next implementation step.

## Report Entry: Queue, Scope, And Progress Snapshot

### Task

Fix codex-hardflow job/daemon behavior so queueing is visible, job-level
concurrency is distinct from SDK worker-level concurrency, and CoveragePlan
selection is driven by structured RouterOutput scope fields rather than
keyword/rule-based special cases.

### Files Changed

- `.gitignore`
- `package.json`
- `src/cli.ts`
- `src/codexHomeIsolation.ts`
- `src/config.ts`
- `src/coverage/coveragePlan.ts`
- `src/coverage/coveragePolicy.ts`
- `src/daemon/daemon.ts`
- `src/daemon/jobRunner.ts`
- `src/diagnostics/sdkDiagnostics.ts`
- `src/hooks/stopValidationGate.ts`
- `src/jobs/jobSchema.ts`
- `src/jobs/jobStore.ts`
- `src/research/researchRequest.ts`
- `src/researchOrchestrator.ts`
- `src/router/providers/codexCli.ts`
- `src/router/routerFallback.ts`
- `src/router/routerNormalize.ts`
- `src/router/routerPrompt.ts`
- `src/router/routerSchema.ts`
- `src/router/routerTrace.ts`
- `src/schemas.ts`
- `src/sourceMatrix.ts`
- `tests/codexCliRouterProvider.test.ts`
- `tests/coveragePlan.test.ts`
- `tests/jobDaemon.test.ts`
- `tests/router.test.ts`
- `tests/routerFixtures.ts`
- `tests/userPromptSubmit.test.ts`
- `tests/validationLoop.test.ts`
- `vitest.config.ts`
- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`

### Summary

- Added structured RouterOutput scope fields: `researchScope`, `evidenceNeed`,
  `localDiagnosisRequired`, `externalResearchRequired`, and
  `exhaustiveCoverageRequired`.
- CoveragePlan now maps `local_diagnostic`, `local_plus_external`,
  `external_exhaustive`, and `implementation_support` to different bucket
  requirements without hardcoded prompt-text tests.
- Daemon status now reports pending/running/queued jobs, global SDK worker
  capacity, active/available workers, and next jobs by priority.
- Jobs now record priority, foreground/current-turn flags, queue position,
  estimated start delay, requested workers, and allocated workers.
- `runPendingHardflowJobs` respects job slots and global SDK worker budget; jobs
  that exceed capacity remain pending instead of failing.
- Stop hook block output now includes a structured `progressSnapshot` so users
  can see queue position and worker/bucket progress.

### Verification Commands

- `npm run build`: passed.
- `npm test`: passed, 28 test files and 233 tests.
- `npm run verify`: passed.
- `npm pack --dry-run --json`: passed.

### Safety Checklist

- [x] Did not change SDK runner concurrency strategy.
- [x] Did not do computed confidence.
- [x] Did not do hidden validator runner work.
- [x] Did not run large diagnostics experiments.
- [x] Did not modify global files.
- [x] Did not use keyword text matching as the new coverage routing mechanism.
- [x] Updated `ai/context/CURRENT_STATE.md`.
- [x] Updated `ai/reports/CODEX_REPORT.md`.

### Risks And Follow-Ups

- Daemon scheduling is conservative and single-process; production supervision
  and multi-process job claiming can be improved later.
- `estimatedStartAfterMs` is a simple queue estimate, not a runtime prediction.
- Future work can add richer worker telemetry to job status without changing the
  Stop gate contract.

### Next ChatGPT Question

Please review the queue/scope/progress snapshot fix using:

- uploaded files and the current `main` diff first;
- `ai/context/CURRENT_STATE.md`;
- `ai/context/PROJECT_CONTEXT.md`;
- `ai/context/REVIEW_PROTOCOL.md`;
- `ai/reports/CODEX_REPORT.md`;
- old chat memory only as unverified context.

Known anomalies:

- Some support files for Codex-home isolation and test scoping were already
  dirty before this follow-up, but they are required by the current build/test
  state and are included in this milestone.
- No real SDK diagnostics experiment was run in this step.
- No global install was run for this change.

Expected output format:

- Review findings first.
- Then state whether the queue/scope/progress model satisfies the intended
  daemon architecture.
- Then list missing tests, docs, or operational gaps.
- Then provide the next Codex-ready prompt.

Next Codex prompt request:

- Please provide the exact next prompt the user should give Codex to address any
  review findings or proceed with the next implementation step.
