# codex-hardflow

codex-hardflow is a global harness for Codex workflows. It combines coverage-first research, isolated executor/validator roles, hidden validation metadata, sanitized feedback, repair loops, final holdouts, private path guards, stop gates, and safe parallel module planning.

The research goal is deliberately aggressive coverage. For research-heavy tasks, hardflow should search any configured source bucket with a non-trivial chance of useful information instead of only selecting the few most likely sources. `coverageMode=exhaustive` is the default for research-heavy, `strict_programmatic`, and `app_handoff` research. Optional buckets are not used in exhaustive mode; required buckets must produce evidence, explicit `searched_but_no_signal`, or an exclusion reason.

Strict exhaustive SDK research defaults to all-required parallelism unless the user sets a lower concurrency. App handoff creates the same exhaustive plan, but execution is best-effort and must be backfilled or marked no-signal/excluded per required bucket before it can satisfy the evidence gate.

Run `codex-hardflow status` after installation to inspect local capability without printing private store paths.
