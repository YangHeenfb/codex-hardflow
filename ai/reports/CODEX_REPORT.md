# Codex Report

## Report Entry: Ask Final Synthesis And Progress Renderer

### Task

Fix `codex-hardflow ask` final answer synthesis and progress display without
changing the SDK runner, daemon/job architecture, coverage policy, computed
confidence, hidden validator, or diagnostics experiments.

### Summary

The ask path now has a distinct language-aware final synthesis step:

- Added `answerSynthesisProvider` support for `codex_cli`, `codex_sdk`, and
  `mock`.
- Real ask research defaults to isolated `codex_cli` synthesis after strict
  research completes.
- Mock ask runs infer the mock synthesis provider, including `--from-run`, so
  tests do not call real Codex.
- Final answer body is synthesized from EvidenceLedger instead of directly
  pasting worker evidence claims as bullets.
- Localized headings, coverage summary, caveats, and run info remain in the
  requested or dominant user language.
- Source titles, URLs, evidence IDs, package/API names, product names, and paper
  titles are preserved.
- Added `OutputLanguagePolicy.confidence`.

Progress output was redesigned:

- `--progress auto|minimal|quiet|verbose|json`.
- TTY text progress clears and rewrites a single stderr line.
- `finish()` clears the progress line and emits a clean newline before final
  stdout output or errors.
- Non-TTY progress suppresses duplicate status lines.
- `--json` ask output suppresses progress by default unless progress is
  explicitly requested.
- Added `--fancy-progress`, `--answer-synthesis-provider`, and
  `--raw-evidence-summary`.

### Files Changed

- `src/ask/answerSynthesis.ts`
- `src/ask/answerSynthesisProvider.ts`
- `src/ask/askRunner.ts`
- `src/ask/progressRenderer.ts`
- `src/cli.ts`
- `src/flagParser.ts`
- `src/i18n/languagePolicy.ts`
- `src/internalEnv.ts`
- `tests/askCli.test.ts`
- `tests/askOutput.test.ts`
- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`

### Smoke

Ran mock smoke:

`codex-hardflow ask "agent 记忆管理方面现在有什么前沿方案？" --router-provider mock --worker-provider mock --answer-synthesis-provider mock --progress quiet`

Result:

- Chinese headings and answer body.
- No raw `Mock evidence for ...` claim bullets in the main answer.
- Source titles and URLs preserved.
- No duplicated source/caveat sections.

### Verification

- `npm run build`: passed.
- `npm test`: passed, 30 test files and 262 tests.
- `npm run verify`: passed.
- `npm pack --dry-run --json`: passed, package entry count `213`.

### Safety

- No SDK runner changes.
- No daemon/job architecture changes.
- No coverage policy changes.
- No computed confidence work.
- No hidden validator work.
- No large diagnostics experiment.
- No global files changed.
- No `install-global` run.

### Risks / Follow-Up

- Real ask runs now perform an additional isolated `codex_cli` synthesis step
  after research. If the local Codex CLI synthesis provider is unavailable, ask
  falls back to a localized evidence summary with an explicit caveat.
- The mock smoke validates formatting and language behavior without running a
  real SDK research job.

## Report Entry: Persist Status File Policy And Remove Next Question Blocks

### Task

Record the durable repository rule that every code, documentation, or
configuration change must update the state files, and remove the old required
next-question policy plus stored question blocks from active handoff documents.

### Summary

Updated project handoff guidance so the durable requirement is now focused on
state maintenance:

- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`

The updated rule says these files are updated after every code, documentation,
or configuration change, with the change summary, verification status, and
current risks or open follow-up.

Removed the old required next-question handoff language from repository
instructions, handoff docs, templates, PR template, review protocol, legacy
context backfill notes, current state, reports, and the historical all-parallel
plan.

### Files Changed

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

### Verification

- Text search confirmed the old next-question requirement strings no longer
  appear in active project handoff files.
- No npm build/test/verify run yet for this documentation-only change.

### Safety

- No product source code changed.
- No SDK runner changes.
- No daemon/job architecture changes.
- No computed confidence work.
- No hidden validator work.
- No large diagnostics run.
- No global files changed.

## Report Entry: Ask CLI, Localized Output, Progress Rendering, And Router Exclusions

### Task

Backfill the durable handoff report for the recent codex-hardflow work that:

- added the synchronous `codex-hardflow ask` CLI;
- improved ask final-answer language preservation and progress rendering;
- fixed router excluded-bucket handling now present at current `main` HEAD.

### Current Branch And HEAD

- Branch: `main`
- Current HEAD: `5239ede Fix router excluded bucket handling`
- Local `main` was aligned with `origin/main` before this status/report update.

### Recent Commits Covered

- `275bb57 Implement synchronous hardflow ask CLI`
- `5d59a5c Refactor ask progress and answer synthesis`
- `5239ede Fix router excluded bucket handling`

### Summary

`codex-hardflow ask` is now the intended standalone synchronous path for users
who want HardFlow research without relying on Codex App foreground hook behavior.

The CLI now:

- routes the question;
- answers directly for `direct_answer` routes;
- runs strict programmatic exhaustive/all-required research for research routes;
- waits for completion;
- synthesizes only from run-owned `research_report.json` / `EvidenceLedger`;
- supports async queueing and later `--from-run` retrieval;
- exposes machine-readable JSON output.

The ask output path now also:

- detects explicit output-language requests such as `中文回答`, `answer in
  English`, `responde en español`, `日本語で答えて`, and similar common patterns;
- defaults to the dominant user prompt language when no explicit language is
  requested;
- localizes final-answer headings, coverage summary, caveats, and run
  information;
- keeps source titles, URLs, evidence IDs, package/API names, product names, and
  paper titles unchanged;
- suppresses duplicate progress lines;
- supports `--progress auto|quiet|verbose|json`;
- caps sources in the answer by default and supports `--show-all-sources` /
  `--show-evidence-ids`.

The latest HEAD also includes router excluded-bucket handling fixes and tests.

More specifically, commit `5239ede` fixed the router/schema mismatch observed
when `codex-hardflow ask "agent 记忆管理方面现在有什么前沿方案？"` received a
router bucket status of `excluded`:

- `RouterOutput.sourceBuckets[*].status` now accepts `excluded` in addition to
  `required`, `possible`, and `not_needed`.
- `routerNormalize` preserves `excluded` and normalizes common model synonyms:
  `optional` / `maybe` -> `possible`, `recommended` / `must_search` ->
  `required`, `not_applicable` / `irrelevant` -> `not_needed`, and
  `unavailable` / `forbidden` / `private_unavailable` /
  `skipped_for_safety` -> `excluded`.
- Invalid bucket statuses now default to `required` with a normalization warning
  instead of silently dropping the bucket.
- Router prompt and repair prompt now explicitly list allowed
  `sourceBuckets.status` values and state that `searched_but_no_signal` belongs
  to completed research bucket results, not RouterOutput.
- CoveragePolicy maps router `excluded` buckets into
  `CoveragePlan.excludedBuckets` and excludes them from `requiredBucketCount`.
- Ask router-failure output is localized for Chinese prompts with
  `路由失败:` and `详情:` while preserving the raw technical error in
  `failureReason` / JSON output.
- Ask progress rendering now finishes open TTY carriage-return status lines with
  a newline so shell prompts or follow-up commands do not glue to the last
  progress line after a router failure.

### Files Changed In Covered Commits

Ask CLI and output:

- `src/ask/askRunner.ts`
- `src/ask/answerSynthesis.ts`
- `src/ask/progressRenderer.ts`
- `src/i18n/languagePolicy.ts`
- `src/cli.ts`
- `src/flagParser.ts`
- `src/daemon/jobRunner.ts`
- `src/jobs/jobSchema.ts`
- `src/jobs/jobStore.ts`
- `tests/askCli.test.ts`
- `tests/askOutput.test.ts`

Router/coverage excluded-bucket handling:

- `src/coverage/coveragePolicy.ts`
- `src/router/llmRouter.ts`
- `src/router/routerNormalize.ts`
- `src/router/routerPrompt.ts`
- `src/router/routerSchema.ts`
- `tests/coveragePlan.test.ts`
- `tests/router.test.ts`

Handoff/status update:

- `ai/context/CURRENT_STATE.md`
- `ai/reports/CODEX_REPORT.md`

### Verification Commands And Result

Run on 2026-06-18 from current `main`:

- `npm run build`: passed.
- `npm test`: passed, 30 test files and 260 tests.
- `npm run verify`: passed.
  - `packDryRunPassed=true`
  - `forbidden=[]`
  - `globalWrapperFresh=true`
  - wrapper target:
    `/Users/yang/Documents/subagents/bin/codex-hardflow`
- `npm pack --dry-run --json`: passed, package entry count `210`.

### Safety Checklist

- [x] Did not modify global files.
- [x] Did not run `install-global`.
- [x] Did not require hook re-trust for CLI-output-only changes.
- [x] Did not change the SDK runner for the ask output/localization work.
- [x] Did not change daemon/job architecture in the ask output/localization step.
- [x] Did not do computed confidence.
- [x] Did not do hidden validator runner work.
- [x] Did not run large diagnostics experiments.
- [x] Did not add raw diagnostics JSON or runtime `.agent` artifacts to git.

### Risks And Follow-Ups

- The deterministic ask synthesis localizes headings/explanations but does not
  translate raw EvidenceLedger claims. This is intentional for evidence
  fidelity; future work could add a constrained translation layer if needed.
- Language detection is heuristic and covers common scripts/languages; obscure
  mixed-language prompts may still need explicit language requests.
- Progress rendering uses available job/worker summary fields. Richer retry or
  slow-worker progress can be added later if worker list summaries expose more
  fields.
- `ask` provides a reliable CLI path, but Codex App hook UX is still a separate
  product surface and should not be treated as fixed by CLI improvements alone.

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
