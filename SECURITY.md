# Security

codex-hardflow is a third-party harness, not an OpenAI official project.

Do not commit or publish Codex credentials, including `~/.codex/auth.json`, tokens, private config backups, hidden tests, regression banks, final holdouts, private validator prompts, or private store contents.

The package does not read, upload, or transmit Codex auth tokens. Runtime paths are derived with `os.homedir()` and explicit process environment variables.

Private artifacts must remain outside the source repository. Hooks are guardrails, not a complete security boundary. Use separate OS users, containers, or other isolation when adversarial executor code is in scope.

Report vulnerabilities by opening a private security advisory or contacting the maintainer through the project's published security channel. Include impact, reproduction steps, affected version, and whether any private artifact was exposed.
