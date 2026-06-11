## Task

Describe the handoff task or milestone this PR covers.

## Plan path

- ai/plans/...

## Codex report path

- ai/reports/CODEX_REPORT.md

## Current state path

- ai/context/CURRENT_STATE.md

## Project context path

- ai/context/PROJECT_CONTEXT.md

## Review protocol path

- ai/context/REVIEW_PROTOCOL.md

## Changed

-

## Verification commands + result

Commands run:

    npm run build
    npm test
    npm run verify
    npm pack --dry-run --json

Result:

- [ ] build passed
- [ ] tests passed
- [ ] verify passed
- [ ] package dry-run passed / not applicable
- [ ] skipped with reason:

## Safety checklist

- [ ] No direct push to main
- [ ] No secrets, tokens, .env contents, raw traces, huge logs, or sensitive personal data
- [ ] Product source/test changes are intentionally included, or confirmed not included
- [ ] Unrelated dirty working tree changes were not staged
- [ ] ai/context/CURRENT_STATE.md was updated
- [ ] ai/reports/CODEX_REPORT.md was updated

## Known anomalies

-

## Next ChatGPT question

Ask ChatGPT:

Source priority:

- Use uploaded files, the current PR diff, `ai/context/CURRENT_STATE.md`, `ai/reports/CODEX_REPORT.md`, and the plan path above.
- Do not rely on old chat memory if it conflicts with repository files or the current PR.

Known anomalies:

-

Expected output format:

- Return review findings first, then a merge/follow-up recommendation, then a Codex-ready next prompt.

Next Codex prompt request:

- Please provide the exact next prompt the user should give Codex.
