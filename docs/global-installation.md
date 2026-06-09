# Global Installation

Run from the source repository:

```sh
npm install
npm run verify
node dist/cli.js install-global
```

The installer writes:

- `~/.codex/AGENTS.md`
- `~/.codex/agents/*.toml`
- `~/.agents/skills/codex-hardflow/SKILL.md`
- `~/.codex/hooks.json`
- `~/.codex-hardflow/current.json`
- `~/.codex-hardflow/state/`
- `~/.local/share/codex-hardflow/private/`

Existing global files are backed up before edits.

After install, open an interactive Codex CLI and run `/hooks`. Review and trust the new hooks. Do not use `--dangerously-bypass-hook-trust`.

Codex Skills official documentation lists `~/.agents/skills` as the user-level path. This Mac also has a legacy/compat `~/.codex/skills` directory. The installer writes the canonical `~/.agents/skills` path first and avoids duplicate active `SKILL.md` files. If interactive `/skills` proves this Codex build only recognizes `~/.codex/skills`, ask before moving or symlinking.
