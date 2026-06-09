# Contributing

This project is intended to be safe to publish from the first release.

Before submitting changes:

- Run `npm run verify`.
- Run `npm pack --dry-run --json` and inspect the package contents.
- Do not add real hidden tests, regression banks, final holdouts, auth files, tokens, private paths, or private fixtures.
- Keep executor-visible reports sanitized.
- Keep hidden validator artifacts outside the repository.
- Prefer small changes with tests for sanitizer, source matrix, validation loop, private path guard, path scope, and package safety behavior.
