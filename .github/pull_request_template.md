## Task

Describe the handoff task or milestone this PR covers.

## Plan path

- ai/plans/...

## Codex report path

- ai/reports/CODEX_REPORT.md

## Current state path

- ai/context/CURRENT_STATE.md

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

## Next ChatGPT question

Ask ChatGPT:

Please review this PR using the plan, Codex report, current state, verification result, and diff. Is this ready to merge, or should Codex do another focused follow-up?
