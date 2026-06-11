# ChatGPT-Codex GitHub Handoff

## Purpose

This directory is a lightweight handoff system for complex AI-assisted work in this repository. It gives ChatGPT, Codex, and GitHub a shared file-based memory so planning, execution, review, and milestone state do not depend on one chat window's context.

This is workflow scaffolding only. It must not change application behavior.

## Role Split

- ChatGPT = Architect / Reviewer
- Codex = Scout / Builder / Tester / Git operator
- GitHub PR = shared review surface
- `ai/context/CURRENT_STATE.md` = source of truth for the current task state

## Standard Loop

1. Codex creates or updates `ai/context/SCOUT.md`.
2. ChatGPT writes a task plan in `ai/plans/`.
3. Codex executes the active plan.
4. Codex updates `ai/reports/CODEX_REPORT.md` and `ai/context/CURRENT_STATE.md`.
5. Codex pushes the branch and opens or updates a draft PR.
6. ChatGPT reviews the GitHub diff and reports the next action.

## Operating Rules

- Keep plans, reports, and current state small enough to review in a PR.
- Record milestone states before pushing review branches.
- Do not commit secrets, tokens, API keys, `.env` contents, raw traces, huge logs, or sensitive personal data.
- If repo reality contradicts a plan, stop, document the mismatch in `ai/reports/CODEX_REPORT.md`, and wait for a revised plan.
- Use GitHub as the durable review surface; use `ai/context/CURRENT_STATE.md` as the durable task state.
- Every next ChatGPT question must name source priority, known anomalies, expected output format, and request the next Codex prompt.
