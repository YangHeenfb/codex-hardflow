# Repository Agent Instructions

## ChatGPT-Codex GitHub Handoff Protocol

- Never push directly to `main` for complex AI tasks.
- Use branches named `agent/YYYY-MM-DD-task-slug`.
- Prefer draft PRs for complex tasks.
- Before editing code, read `ai/context/CURRENT_STATE.md` and the active plan in `ai/plans/`.
- If the plan contradicts repo reality, stop and update `ai/reports/CODEX_REPORT.md`.
- Before pushing, update `ai/reports/CODEX_REPORT.md` and `ai/context/CURRENT_STATE.md`.
- Push only reviewable milestone states.
- Do not commit secrets, raw traces, huge logs, `.env` files, or sensitive personal data.
