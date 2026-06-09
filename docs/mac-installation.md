# Mac Installation

Recommended baseline for this Mac:

- Codex CLI `0.134.0`
- `@openai/codex-sdk` `0.134.0`

Do not force-upgrade to latest. Upgrade only when explicitly requested and after checking CLI/SDK compatibility.

`TERM=dumb` cannot complete interactive hook trust. Use a normal interactive Codex CLI, run `/hooks`, review the hook commands, and trust them.

Remote package or latest checks can hit HTTP 403 in this environment. Treat that as an inability to confirm, not as a failure that requires upgrading.

Add `bin/codex-hardflow` to `PATH` or use `npm link` after `npm run build`.

Skills path strategy:

- Canonical user skill path: `~/.agents/skills/codex-hardflow/SKILL.md`
- Legacy/compat path observed on this Mac: `~/.codex/skills`
- The installer probes and avoids duplicate active same-name skills.
