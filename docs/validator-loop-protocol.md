# Validator Loop Protocol

Default loop:

1. Executor completes and writes `executor_manifest.json`.
2. Validator generates hidden cases in private storage.
3. Public and hidden validation run in a clean workspace strategy.
4. Failed hidden validation updates the private regression bank.
5. Executor receives sanitized repair feedback.
6. Validator reruns regression categories and fresh dissimilar cases.
7. After normal hidden validation passes, final holdout must pass.

Defaults:

- `max_repair_cycles`: 3
- `fresh_cases_per_cycle`: 5
- `min_holdout_cases`: 5
- `rerun_regression_bank`: true
- `stop_on_suspected_cheating`: true

Stop when final holdout passes or max repair cycles require user intervention. Do not disclose failed hidden cases.
