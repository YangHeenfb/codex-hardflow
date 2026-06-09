# Open Source Release Checklist

- Run `npm run build`.
- Run `npm test`.
- Run `npm run verify`.
- Run `npm pack --dry-run --json`.
- Inspect package contents.
- Run a secret scan.
- Check `LICENSE`.
- Check `SECURITY.md`.
- Check no real private artifacts exist in the repo.
- Check no real hidden tests, regression banks, or final holdout files are included.
- Check no `~/.codex/auth.json`, tokens, or secrets are included.
- Check runtime source does not hardcode machine-specific absolute paths.
