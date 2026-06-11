# All-Parallel Stress Diagnostics Plan

## Objective

Run a real isolated codex-hardflow SDK diagnostics experiment to compare the existing baseline concurrency of `3` against all required external research buckets running in parallel. The goal is to determine whether `all_required` parallelism is faster than concurrency `3` without a significant stability regression.

## Plan Path

`ai/plans/2026-06-11-all-parallel-stress.md`

## Codex Report Path

`ai/reports/CODEX_REPORT.md`

## Current State Path

`ai/context/CURRENT_STATE.md`

## Non-Goals

- Do not commit or push.
- Do not modify global files.
- Do not use `--dangerously-bypass-hook-trust`.
- Do not run the full `1,2,3,6 x 3` matrix.
- Do not run prompt-width diagnostics.
- Do not run hidden validator work, computed confidence, or hidden validator runner.
- Do not modify App subagents.
- Do not add a community bucket.
- Do not add `local_repo` unless the existing implementation strictly requires it.
- Do not use latest/current report as an input shortcut.
- Do not implement literal `all` parser support during this experiment.

## Preconditions

Run and require success before any real SDK execution:

```sh
npm run build
npm test
npm run verify
npm pack --dry-run --json
```

Confirm before real SDK execution:

- Diagnostics isolation harness is available.
- `contaminationDetected` must be false.
- No App subagents.
- No manual fallback.
- No AGENTS/skill fallback.
- All runs use `strict_programmatic` / `sdk_threads`.
- Each run uses an independent isolated repo/home.
- Each worker uses a new SDK thread.
- No latest/current report selection is used.
- All coverage evals explicitly use `--run-id`.

If any precondition or isolation assertion fails, stop before real SDK execution and update the current state and report.

## Exact Experiment Design

Task:

`Compare current practical approaches for hidden validation in AI coding agents.`

Required external buckets:

- `official_docs`
- `github`
- `academic`
- `security`
- `package_registry`
- `codex_default_discovery`
- `competitors`

Variants:

- baseline: `maxConcurrentBuckets=3`
- all_parallel: `maxConcurrentBuckets=7`, equal to all required external buckets

Repeats:

- 2 per variant

Worker config:

- `maxSourcesPerWorker=2`
- `heartbeatIntervalMs=60000`
- `workerLeaseMs=180000`
- `softTimeoutMs=900000`
- `hardTimeoutMs=1800000`
- `globalBudgetMs=3600000`
- `maxNoProgressHeartbeats=3`
- `maxNoArtifactProgressIntervals=3`
- `maxNoSemanticProgressIntervals=5`
- `maxCheckpointNudges=2`

The CLI currently parses `--concurrency-levels` as numeric CSV, so the experiment will use `3,7` and map `7` to `all_parallel` in the report.

## Commands To Run

Preconditions:

```sh
npm run build
npm test
npm run verify
npm pack --dry-run --json
```

Real SDK experiment, only after preconditions pass:

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

## Output Path

`.agent/reports/diagnostics/sdk-all-parallel-stress.json`

Experiment workspaces:

`/tmp/codex-hardflow-diagnostics-all-parallel`

## Metrics To Collect

For each run:

- `runId`
- variant: `baseline` or `all_parallel`
- `maxConcurrentBuckets`
- `requiredBucketCount`
- `startedAt`
- `endedAt`
- `durationMs`
- `completedBucketCount`
- `timeoutBucketCount`
- `timeoutRateExcludingTransient`
- `failedBucketCount`
- `invalidJsonCount`
- `sourceCount`
- `averageSourcesFound`
- `coverage_score`
- `programmaticMultiAgent`
- `contaminationDetected`

For each worker:

- `bucket`
- `status`
- `durationMs`
- `timeToFirstEvidenceMs`
- `partialEvidenceCount`
- `sourcesFoundCount`
- `retryCount`
- `transientNetworkErrorCount`
- `retrySuccess`
- `noActivityProgressCount`
- `noArtifactProgressCount`
- `noSemanticProgressCount`
- `checkpointNudgeCount`
- `checkpointNudgeSuccessCount`
- `failureCategory`
- `failureReason`

Summary by variant:

- `completedRate`
- `timeoutRate`
- `timeoutRateExcludingTransient`
- `failedRate`
- `invalidJsonRate`
- `retrySuccessRate`
- `transientNetworkErrorRate`
- `noActivityProgressRate`
- `noArtifactProgressRate`
- `noSemanticProgressRate`
- `checkpointNudgeSuccessRate`
- `medianDurationMs`
- `p90DurationMs`
- `medianTimeToFirstEvidenceMs`
- `averageSourcesFound`
- `averageCoverageScore`

## Decision Logic

Compute:

```text
durationImprovement = (baselineMedianDurationMs - allParallelMedianDurationMs) / baselineMedianDurationMs
coverageDelta = allParallelAverageCoverageScore - baselineAverageCoverageScore
```

`stabilityRegression=true` if any of these are true:

- `allParallel.timeoutRateExcludingTransient > baseline.timeoutRateExcludingTransient + 0.15`
- `allParallel.noActivityProgressRate > baseline.noActivityProgressRate + 0.15`
- `allParallel.failedRate > baseline.failedRate + 0.15`
- `allParallel.invalidJsonRate > baseline.invalidJsonRate + 0.10`

Recommendation:

- `all_required_parallel_viable` if `durationImprovement >= 0.20`, `stabilityRegression=false`, and `coverageDelta >= -5`.
- `keep_concurrency_3_or_adaptive` if `all_parallel` has `stabilityRegression=true`.
- Otherwise `inconclusive_repeat_needed`.

Do not claim all-parallel is default-ready unless the criteria pass.

## Stop Conditions

- Any precondition command fails.
- Diagnostics isolation harness is missing.
- Isolation assertion fails.
- `contaminationDetected` is true.
- Any run uses app_handoff, manual fallback, AGENTS/skill fallback, or latest/current report selection.
- The experiment would require modifying global files, hidden validator work, App subagents, or parser feature work.
- The experiment would require committing raw logs, secrets, `.env` contents, or huge traces.

## Safety Checklist

- [x] No auto commit.
- [x] No push.
- [x] No global file modification.
- [x] No `--dangerously-bypass-hook-trust`.
- [x] No full `1,2,3,6 x 3` matrix.
- [x] No prompt-width diagnostics.
- [x] No hidden validator work.
- [x] No App subagent modification.
- [x] No unrelated dirty working tree changes staged.
- [x] `ai/context/CURRENT_STATE.md` updated before final.
- [x] `ai/reports/CODEX_REPORT.md` updated before final.

## Execution Result

Experiment completed with `experimentId=diag-2026-06-11T12-22-45-064Z-6dbb5de7`.

Output:

`.agent/reports/diagnostics/sdk-all-parallel-stress.json`

Summary:

- baseline (`maxConcurrentBuckets=3`): median duration `522481ms`, completed rate `0.8571`, failed rate `0.1429`, timeout excluding transient `0`, no-activity rate `0.1429`, average coverage score `99`.
- all_parallel (`maxConcurrentBuckets=7`): median duration `115798ms`, completed rate `1`, failed rate `0`, timeout excluding transient `0`, no-activity rate `0`, average coverage score `100`.

Decision logic result:

- `durationImprovement=0.7784`
- `coverageDelta=1`
- `stabilityRegression=false`
- `recommendation=all_required_parallel_viable`

This is an experiment-only finding. It is not a default policy change.

## Next ChatGPT Question

Please review the all-parallel stress experiment using the plan, current state, Codex report, diagnostics JSON output, and command summary. Did the experiment follow the intended design, and is all_required parallel viable based on the decision criteria?
