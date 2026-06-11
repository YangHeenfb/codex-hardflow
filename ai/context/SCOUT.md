# Scout Report

## Last Updated

2026-06-11

## Relevant Repo Structure

- `bin/codex-hardflow`: package CLI binary entrypoint.
- `src/`: TypeScript source for the codex-hardflow CLI, hooks, routing, orchestration, validation, diagnostics, and related utilities.
- `src/templates/`: prompt and agent templates used by the CLI.
- `tests/`: Vitest test suite.
- `docs/`: project protocol and installation documentation.
- `examples/`: example manifests, validators, modules, and reports.
- `dist/`: generated build output; ignored by git.
- `.agent/`: local agent report and manifest area; most generated contents are ignored.

## Stack And Package Manager

- Runtime/package type: Node.js TypeScript package, ESM (`"type": "module"`).
- Node version: `>=18`.
- Package manager: npm, based on `package-lock.json`.
- Main output: `dist/index.js`.
- CLI binary: `codex-hardflow` mapped to `./bin/codex-hardflow`.
- Key dependencies: `@openai/codex-sdk`, `zod`.
- Key dev dependencies: `typescript`, `tsx`, `vitest`, `@types/node`.

## Existing Commands

- Build/typecheck: `npm run build`
- Test: `npm test`
- Development CLI: `npm run dev`
- Hardflow CLI shortcut: `npm run hardflow`
- Full verification: `npm run verify`
- Lint: no lint script declared in `package.json`

## Existing Docs Or Conventions

- `README.md` documents install, quick start, hardflow routing, report ownership, global installation, and safety boundaries.
- `CONTRIBUTING.md` asks contributors to run `npm run verify` and inspect `npm pack --dry-run --json`.
- `.gitignore` already excludes dependencies, build output, coverage, `.env` files, generated local agent contents, sensitive local stores, generated validation data, and package tarballs.
- Existing commits use concise imperative messages such as `Implement SDK research runner` and `Add coverage planning and evidence ledger`.

## GitHub And CI Observations

- Remote: `origin` points to `https://github.com/YangHeenfb/codex-hardflow.git`.
- No local `.github/` directory was present during inspection.
- No GitHub Actions workflow, PR template, or issue template was visible locally.
- CI expectations should be treated as unknown unless confirmed from GitHub.

## Risks And Unknowns

- The working tree already had uncommitted product source/test changes before this scaffold task; keep this scaffold isolated from those changes.
- Current branch is `main`; workflow docs should prefer creating a review branch before committing or pushing.
- No lint command is declared; do not invent one in task plans.
- `npm run verify` may be affected by pre-existing unrelated changes, so scaffold validation should focus on changed paths unless broader verification is explicitly requested.
