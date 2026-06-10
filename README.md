# codex-hardflow

codex-hardflow is a third-party global harness for Codex workflows. It focuses on coverage-first research, executor/validator separation, sanitized validation feedback, repair loops, final holdout checks, and dry-run-safe parallel module planning.

It is not an OpenAI official project.

## Current Capabilities

- Builds a Source Coverage Matrix for broad research.
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
codex-hardflow report add-source --run-id <runId> --bucket official_docs --title "Docs" --url "https://example.com" --claim "Primary source reviewed"
codex-hardflow report add-subagent-report --run-id <runId> --agent official_docs_researcher --bucket official_docs --status completed
codex-hardflow report merge-subagents --run-id <runId>
codex-hardflow report finalize-manual --run-id <runId> --useful-finding "Recorded App/manual research evidence"
codex-hardflow hooks assert-active --run-id <runId>
codex-hardflow eval coverage --run-id <runId>
codex-hardflow implement "add validation-sensitive feature"
codex-hardflow validate
codex-hardflow repair-loop
codex-hardflow parallel modules.yaml
codex-hardflow verify
```

Task routing is handled by the structured LLM Router and recorded in `.agent/reports/runs/<runId>/router_trace.json`. Parent router traces update `.agent/reports/current/router_trace.json`; subagent router traces are isolated under `.agent/reports/runs/<runId>/subagents/*.router_trace.json` and must not overwrite current. `research --run-id <runId>` reuses an existing parent router trace for the same runId by default; `--run-router` explicitly reruns and replaces it. `--strict-programmatic` uses SDK threads and fails instead of falling back to App/AGENTS/skill/manual flow when SDK threads are unavailable. `--write-trace` is a boolean flag and does not consume task text. Deterministic keyword heuristics are only safety/preflight diagnostics, not the primary route source.

AGENTS.md and the codex-hardflow skill are protocol documentation, not enforcement triggers. A run can claim hardflow completion only when a hook/CLI audit trail records `programmaticTrigger=true`.

Use `codex-hardflow research --runner sdk_threads` or `--execute-sdk-research` only when you intentionally want the CLI to launch Codex SDK researcher threads. Interactive Codex App turns should use `app_handoff` and backfill App/manual/subagent findings through the `report` CLI. Parent reports are run-owned under `.agent/reports/runs/<runId>/research_report.json`; `.agent/reports/current/research_report.json` is only the current parent copy.

## Global Installation

`codex-hardflow install-global` writes global files under Codex/user directories with backups for existing files. Hooks are configured but not trusted automatically. Open an interactive Codex CLI, run `/hooks`, review the commands, and trust them.

## Safety Boundary

Hooks are guardrails. They reduce accidental leakage of hidden tests and private artifacts, but they are not a complete sandbox. Strong isolation requires keeping the private store outside the repo, hiding private paths from executor context, running validators in isolated processes, and using OS user/container isolation when needed.

## Open Source Notes

The repository ignores and excludes private artifacts, `.agent` reports/manifests, hidden tests, private JSON, config backups, and local auth. Run `npm run verify` and inspect `npm pack --dry-run --json` before publishing.
