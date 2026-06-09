# Threat Model

codex-hardflow helps prevent accidental disclosure of hidden validation artifacts and encourages coverage-first research. It protects against common workflow mistakes such as exposing hidden fixture values in repair prompts or reading private validator files from executor context.

It does not provide a complete security boundary. Hooks can be bypassed by a malicious or compromised process. A process with filesystem access can attempt side channels outside hook coverage.

Private store paths must remain outside the repository. Executor environments should not contain private path variables. Validator sessions should be separate from executor sessions.

Use OS user isolation, containers, VMs, or remote sandboxes when adversarial executor code is in scope.
