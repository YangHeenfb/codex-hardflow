# Coverage Eval

Use coverage eval to inspect whether a hardflow run covered the configured CoveragePlan. Without a baseline, it reports configured-matrix breadth only; it must not claim that hardflow was strictly broader than default Codex search.

## Commands

```sh
codex-hardflow eval coverage --run-id <hardflowRunId>
codex-hardflow eval coverage --run-id <hardflowRunId> --baseline-run-id <baselineRunId>
```

When `.agent/reports/runs/<runId>/coverage_plan.json` and `evidence_ledger.json` exist, eval uses them first. The output includes bucket coverage, question coverage, perspective coverage, engine diversity, source diversity, primary-source counts, weak community signal counts, GitHub/academic/security/package/local-repo counts, codex_default_discovery presence, searched-but-no-signal records, subagent spawned count, manual backfill count, evidence gate status, and `coverage_score`.

When no CoveragePlan exists, eval falls back to the legacy research report metrics.

App subagents are optional workers, not the coverage mechanism. A run can satisfy coverage with manual/SDK evidence ledger entries while `subagent_status="not_spawned"`. A spawned subagent without evidence ledger entries does not satisfy coverage by itself.

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

If a baseline is supplied, compare the baseline source count, source type count, and bucket coverage ratio. If no baseline is supplied, state only that hardflow coverage is broad by configured matrix.
