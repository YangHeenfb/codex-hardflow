# Mac Installation

Recommended baseline for this Mac:

- Codex CLI `0.134.0`
- `@openai/codex-sdk` `0.134.0`

Do not force-upgrade to latest. Upgrade only when explicitly requested and after checking CLI/SDK compatibility.

`TERM=dumb` cannot complete interactive hook trust. Use a normal interactive Codex CLI, run `/hooks`, review the hook commands, and trust them.

Remote package or latest checks can hit HTTP 403 in this environment. Treat that as an inability to confirm, not as a failure that requires upgrading.

Recommended install:

```sh
node dist/cli.js install-global --mode strict
```

Strict mode installs hooks/wrapper/config only. It does not install a HardFlow AGENTS block, active skill, or App subagents by default.

Optional skill path strategy for `--with-skill` only:

- Canonical user skill path: `~/.agents/skills/codex-hardflow/SKILL.md`
- Legacy/compat path observed on this Mac: `~/.codex/skills`
- Strict install removes old active same-name skills after backup; optional assisted install writes the canonical path first.
