# Parallel Modules Protocol

Parallel workers need explicit `path_scope`.

Rules:

- Overlapping `path_scope` forbids parallel code writers.
- Shared contracts, shared types, and shared config are handled first by Lead.
- Each worker may modify only its `path_scope`.
- Each worker must write an executor manifest.
- Per-module public checks run before merge.
- Full hidden validation loop runs after merge.

Git worktree execution requires a HEAD commit. If the repo has no initial commit, hardflow defaults to dry-run or temp-copy fallback and does not force `git worktree`.
