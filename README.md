# codex-hardflow

codex-hardflow is a third-party global harness for Codex workflows. It focuses on coverage-first research, executor/validator separation, sanitized validation feedback, repair loops, final holdout checks, and dry-run-safe parallel module planning.

It is not an OpenAI official project.

## Research Philosophy

codex-hardflow is coverage-first. For research-heavy work, the goal is to expand the search surface, not to imitate a short default search. In exhaustive mode, any source bucket with a non-trivial chance of useful information is searched, even when the expected signal is weak or costly to collect.

`coverageMode` controls that behavior:

- `exhaustive`: default for research-heavy, `strict_programmatic`, and `app_handoff` research. Optional buckets are not used; applicable buckets are required, searched, explicitly marked `searched_but_no_signal`, or excluded with a reason.
- `balanced`: keeps possible buckets as coverage debt when skipped.
- `fast`: minimizes required coverage for explicitly fast runs.

Weak sources such as community discussions can be required in exhaustive mode while still being low priority and low confidence. `codex_default_discovery` is always required in exhaustive research so the run can find missed perspectives.

## Current Capabilities

- Builds a Source Coverage Matrix for broad research.
- Writes a run-owned exhaustive CoveragePlan and EvidenceLedger for coverage-first research.
- Always includes `codex_default_researcher` for research-heavy tasks.
- Requires executor manifests for validation-sensitive implementation.
- Stores private validator metadata outside the repository.
- Sanitizes hidden validation feedback.
- Blocks obvious private-path access through a PreToolUse guard.
- Blocks stopping before manifest/validation/final holdout states when hardflow is required.
- Plans parallel module work and disables worktree execution when the repo has no HEAD commit.
- Installs concise global Codex guidance, custom agents, hooks config, and a canonical user skill.

## Install

```sh
npm install
npm run verify
node dist/cli.js install-global
```

The package pins `@openai/codex-sdk` to `0.134.0`. Do not upgrade the Codex CLI or SDK unless you intentionally choose to.

## Quick Start

```sh
codex-hardflow status
codex-hardflow route --run-id <runId> --write-trace "compare current React data fetching options"
codex-hardflow route --owner subagent --parent-run-id <runId> --subagent-name local_repo_researcher --bucket local_repo --write-trace "inspect local repo evidence"
codex-hardflow research --run-id <runId> --runner app_handoff "compare current React data fetching options"
codex-hardflow research --run-id <runId> --runner app_handoff --run-router "compare current React data fetching options"
codex-hardflow research --run-id <runId> --strict-programmatic "compare current React data fetching options"
codex-hardflow research --run-id <runId> --coverage-mode balanced --runner app_handoff "compare current React data fetching options"
codex-hardflow report add-source --run-id <runId> --bucket official_docs --title "Docs" --url "https://example.com" --claim "Primary source reviewed"
codex-hardflow report add-subagent-report --run-id <runId> --agent official_docs_researcher --bucket official_docs --status completed
codex-hardflow report merge-subagents --run-id <runId>
codex-hardflow report finalize-manual --run-id <runId> --useful-finding "Recorded App/manual research evidence"
codex-hardflow hooks assert-active --run-id <runId>
codex-hardflow eval coverage
codex-hardflow eval coverage --run-id <runId>
codex-hardflow eval coverage --run-id <runId> --baseline-run-id <baselineRunId>
codex-hardflow implement "add validation-sensitive feature"
codex-hardflow validate
codex-hardflow repair-loop
codex-hardflow parallel modules.yaml
codex-hardflow verify
```

Task routing is handled by the structured LLM Router and recorded in `.agent/reports/runs/<runId>/router_trace.json`. Parent router traces update `.agent/reports/current/router_trace.json`; subagent router traces are isolated under `.agent/reports/runs/<runId>/subagents/*.router_trace.json` and must not overwrite current. UserPromptSubmit creates a router-required marker for every non-empty prompt; route decisions come from the LLM Router, not AGENTS.md, skills, or keyword classification. `research --run-id <runId>` reuses an existing parent router trace for the same runId by default; `--run-router` explicitly reruns and replaces it. `route=research` defaults to `strict_programmatic`, `coverageMode=exhaustive`, and `parallelPolicy=all_required`. If SDK threads are unavailable, or if no required buckets/workers are produced, strict mode fails honestly instead of falling back to App/AGENTS/skill/manual flow. In exhaustive strict research, SDK execution defaults to all required buckets in parallel unless the user sets a lower concurrency. `--write-trace` is a boolean flag and does not consume task text. Deterministic keyword heuristics are only safety/preflight diagnostics, not the primary route source.

AGENTS.md and the codex-hardflow skill are protocol documentation, not enforcement triggers. A run can claim hardflow completion only when a hook/CLI audit trail records `programmaticTrigger=true`.

Use `codex-hardflow research --runner app_handoff` only for explicit interactive/manual mode or a user-approved downgrade after strict failure. `app_handoff` creates an exhaustive plan but is best-effort execution; every required bucket still needs evidence, an explicit `searched_but_no_signal`, or an exclusion reason. It does not imply `programmaticMultiAgent=true`; manual source backfill changes `evidence_mode`, not `runner_mode`. Parent reports are run-owned under `.agent/reports/runs/<runId>/research_report.json`; `.agent/reports/current/research_report.json` is only the current parent copy. During implementation, external docs/examples/security/version/troubleshooting needs should be recorded as ResearchRequests and resolved through strict programmatic research instead of guessed.

Coverage scores are measured against the configured hardflow matrix/plan. In exhaustive mode, `eval coverage` counts a required bucket as covered only when it has evidence, an explicit no-signal record, or a valid exclusion reason. `eval coverage` can select the latest evidence-bearing parent run by default, but claims that hardflow was broader than default Codex search require a valid `--baseline-run-id`.

## Global Installation

`codex-hardflow install-global` writes global files under Codex/user directories with backups for existing files. Hooks are configured but not trusted automatically. Open an interactive Codex CLI, run `/hooks`, review the commands, and trust them.

## Safety Boundary

Hooks are guardrails. They reduce accidental leakage of hidden tests and private artifacts, but they are not a complete sandbox. Strong isolation requires keeping the private store outside the repo, hiding private paths from executor context, running validators in isolated processes, and using OS user/container isolation when needed.

## Open Source Notes

The repository ignores and excludes private artifacts, `.agent` reports/manifests, hidden tests, private JSON, config backups, and local auth. Run `npm run verify` and inspect `npm pack --dry-run --json` before publishing.
