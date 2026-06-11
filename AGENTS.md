# Repository Agent Instructions

## ChatGPT-Codex GitHub Handoff Protocol

- Never push directly to `main` for complex AI tasks.
- Use branches named `agent/YYYY-MM-DD-task-slug`.
- Prefer draft PRs for complex tasks.
- Before editing code, read `ai/context/CURRENT_STATE.md` and the active plan in `ai/plans/`.
- For complex planning/review tasks, also read `ai/context/PROJECT_CONTEXT.md` and `ai/context/REVIEW_PROTOCOL.md`.
- If the plan contradicts repo reality, stop and update `ai/reports/CODEX_REPORT.md`.
- Before pushing, update `ai/reports/CODEX_REPORT.md` and `ai/context/CURRENT_STATE.md`.
- Push only reviewable milestone states.
- Do not commit secrets, raw traces, huge logs, `.env` files, or sensitive personal data.

## Repository verification

- Package manager: npm.
- Node.js: >=18.
- Build/typecheck: `npm run build`.
- Tests: `npm test`.
- Full verification: `npm run verify`.
- No lint script is currently declared; do not invent `npm run lint`.
- For packaging or release-impacting changes, run `npm pack --dry-run --json` and inspect the package contents.

## Dirty working tree policy

- Before staging, run `git status --short`.
- If unrelated product source/test changes exist, do not stage them.
- Use explicit pathspecs when staging scaffold or task-specific files.
- If isolation is unclear, stop and report before committing.

## Push policy

- Do not push unless the user explicitly asked to push or open/update a PR.
- Never force-push, delete branches, reset hard, or clean untracked files without explicit approval.

## Next ChatGPT question policy

Every `Next ChatGPT question` must include:

- Source priority: tell ChatGPT to use uploaded files, the current PR, and current state files instead of old chat memory.
- Known anomalies: list stale state, dirty working tree, skipped checks, missing artifacts, or other caveats.
- Expected output format: specify whether ChatGPT should return a plan, review findings, a merge decision, or a Codex-ready prompt.
- Next Codex prompt request: ask ChatGPT to provide the exact next prompt the user should give Codex.
