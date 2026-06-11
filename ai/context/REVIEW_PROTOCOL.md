# Review Protocol

## Role Split

- ChatGPT = Architect / Reviewer.
- Codex = Scout / Builder / Tester / Git operator.
- GitHub PR = shared review surface.
- `ai/context/CURRENT_STATE.md` = current task state source of truth.

## Source Priority

A new ChatGPT conversation should treat repo files and uploaded artifacts as
source of truth, not old chat memory.

Use this order:

1. Uploaded files, current PR, and current branch diff.
2. `ai/context/CURRENT_STATE.md`.
3. `ai/context/PROJECT_CONTEXT.md`.
4. `ai/context/REVIEW_PROTOCOL.md`.
5. `ai/decisions/DECISION_LOG.md`.
6. Active plan under `ai/plans/`.
7. Latest `ai/reports/CODEX_REPORT.md`.
8. Old ChatGPT history only as unverified historical context.

## Required Files To Read

For complex planning or review, read:

- `AGENTS.md`
- `ai/README.md`
- `ai/context/CURRENT_STATE.md`
- `ai/context/PROJECT_CONTEXT.md`
- `ai/context/REVIEW_PROTOCOL.md`
- `ai/decisions/DECISION_LOG.md`
- the active plan under `ai/plans/`
- `ai/reports/CODEX_REPORT.md`

## How To Treat Old Chat History

- Old chat history can explain why a decision might exist.
- Old chat history is not proof that a repo feature exists.
- Treat migrated legacy context as historical input until repo files, command
  output, or PR diffs verify it.
- Do not use old memory to override current repo facts.

## How To Handle Stale Or Contradictory State

- Prefer current repo files and command output over narrative summaries.
- If `CURRENT_STATE.md`, reports, and plans disagree, call out the conflict.
- If branch names, plan paths, or experiment outputs look stale, list them as
  known anomalies.
- Ask Codex to refresh state before implementation when stale state changes
  the plan.

## Required Output Shape

ChatGPT review output should include:

- Summary of what was reviewed.
- Findings or risks first, ordered by severity.
- Decision: ready to merge, needs follow-up, needs clarification, or blocked.
- Verification gaps and safety concerns.
- Next Codex prompt, if action is needed.

## Required Next Codex Prompt Shape

The next Codex prompt should include:

- Source priority: use uploaded files, current PR/diff, and repo context files
  instead of old chat memory.
- Known anomalies: stale state, dirty working tree, skipped checks, missing
  artifacts, or contradictory claims.
- Objective and non-goals.
- Files in scope and files out of scope.
- Verification commands and expected reporting.
- Whether Codex may commit or push.

## Safety Review Checklist

- No secrets, tokens, `.env` contents, raw logs, huge artifacts, or sensitive
  personal data are committed.
- Product source/test changes are intentional and scoped.
- Generated diagnostics or private validation artifacts are summarized, not
  pasted wholesale.
- Strict execution claims have artifacts.
- Experiment-only findings are not presented as implemented defaults.
- Handoff files are updated when the task changes durable state.
