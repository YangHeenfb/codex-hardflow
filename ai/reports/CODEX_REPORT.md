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
