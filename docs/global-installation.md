# Global Installation

Run from the source repository:

```sh
npm install
npm run verify
node dist/cli.js install-global --mode strict
```

Strict mode is the default and is the recommended install. It writes:

- `~/.codex/hooks.json`
- `~/.codex/config.toml`
- `~/.codex-hardflow/current.json`
- `~/.codex-hardflow/state/`
- `~/.local/share/codex-hardflow/private/`
- `~/.local/bin/codex-hardflow`

Strict mode does not install HardFlow content into `~/.codex/AGENTS.md`, does not install an active `codex-hardflow` skill, and does not install App subagents. If an old managed HardFlow AGENTS block or active codex-hardflow skill is present, strict install removes it after writing a backup.

Optional assisted additions are explicit:

```sh
node dist/cli.js install-global --mode assisted
node dist/cli.js install-global --with-skill
node dist/cli.js install-global --with-app-agents
node dist/cli.js install-global --with-agents-docs
```

Assisted mode may write:

- `~/.codex/AGENTS.md` docs block
- `~/.codex/agents/*.toml`
- `~/.agents/skills/codex-hardflow/SKILL.md`

Existing global files are backed up before edits.

After install, open an interactive Codex CLI and run `/hooks`. Review and trust the new hooks. Do not use `--dangerously-bypass-hook-trust`.

Codex Skills official documentation lists `~/.agents/skills` as the user-level path. Strict mode keeps the codex-hardflow skill uninstalled because skills can be implicitly invoked by description. If you intentionally install the optional skill and interactive `/skills` proves this Codex build only recognizes `~/.codex/skills`, ask before moving or symlinking.
