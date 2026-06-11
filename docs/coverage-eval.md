# Coverage Eval

Use coverage eval to inspect whether a hardflow run covered the configured CoveragePlan. Without a baseline, it reports configured-matrix breadth only; it must not claim that hardflow was strictly broader than default Codex search.

## Commands

```sh
codex-hardflow eval coverage
codex-hardflow eval coverage --latest-evidence-run
codex-hardflow eval coverage --run-id <hardflowRunId>
codex-hardflow eval coverage --run-id <hardflowRunId> --baseline-run-id <baselineRunId>
codex-hardflow eval coverage --include-test-runs
```

When no `--run-id` is supplied, eval selects the latest evidence-bearing parent run. It excludes plumbing/test/audit/dry-run/router-only runs by default. Use `--include-test-runs` only when intentionally evaluating test fixtures. If no evidence-bearing parent run exists, pass `--run-id`.

When `.agent/reports/runs/<runId>/coverage_plan.json` and `evidence_ledger.json` exist, eval uses them first. The output includes selected run metadata, `coverageMode`, required bucket count, completed/backfilled required bucket count, excluded bucket count and reasons, skipped possible buckets, coverage debt, question coverage, perspective coverage, engine diversity, source diversity, primary-source counts, weak community signal counts, GitHub/academic/security/package/local-repo counts, codex_default_discovery presence, searched-but-no-signal records, subagent spawned count, manual backfill count, `programmaticTrigger`, `programmaticMultiAgent`, evidence gate status, and `coverage_score`.

In exhaustive mode, bucket coverage counts required buckets completed by evidence, explicit `searched_but_no_signal`, or a valid exclusion reason. Silently skipped required buckets sharply lower the score and fail the evidence gate. Balanced and fast modes may report skipped possible buckets as coverage debt.

When no CoveragePlan exists, eval falls back to the legacy research report metrics.

App subagents are optional workers, not the coverage mechanism. A run can satisfy coverage with manual/SDK evidence ledger entries while `subagent_status="not_spawned"`. A spawned subagent without evidence ledger entries does not satisfy coverage by itself. `app_handoff` does not imply `programmaticMultiAgent=true`; manual backfill updates `evidence_mode`, not `runner_mode`.

`strict_programmatic` currently requires SDK threads or another deterministic worker runner. If no required buckets are produced, the SDK runner is unavailable, or zero workers start, the run status is `failed`.

## A/B Workflow

A. Default Codex baseline:

1. Ask for a quick/no-hardflow answer.
2. Record any sources manually into a baseline report if comparison is needed.
3. Do not claim hardflow execution for the baseline unless `programmaticTrigger=true`.

B. Hardflow run:

1. Create a route trace and run-owned report with `codex-hardflow research --run-id <runId>`.
2. Inspect `.agent/reports/runs/<runId>/coverage_plan.json`.
3. Backfill App/manual/subagent evidence with report commands. These commands also write `.agent/reports/runs/<runId>/evidence_ledger.json`.
4. Run `codex-hardflow report assert-evidence --run-id <runId>`.
5. Run `codex-hardflow eval coverage --run-id <runId>`.

Compare:

- source buckets covered
- research questions covered
- perspectives covered
- engine diversity
- primary sources
- GitHub, academic, security, package registry, and local repo sources
- searched-but-no-signal records
- actual subagent or SDK-thread usage
- evidence gate result

If a valid baseline is supplied, compare the baseline source count, source type count, bucket coverage ratio, primary source count, and coverage score. Eval also outputs delta metrics. If no baseline is supplied, `baselinePresent=false`, `broaderThanDefaultClaimAllowed=false`, and you should state only that hardflow coverage is broad by configured matrix.
