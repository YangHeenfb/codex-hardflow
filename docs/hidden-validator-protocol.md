# Hidden Validator Protocol

Executor and validator roles are isolated.

The executor may implement code, add public tests, run public checks, and write `executor_manifest.json`. It must not read hidden validator directories, private store paths, hidden fixtures, validator prompts, regression banks, or final holdout files.

The validator runs after executor completion. It reads the original task, public spec, research report, and executor manifest. It generates hidden validation outside the repository and returns only sanitized summaries.

Sanitized feedback may include category, severity, public spec reference, broad input class, likely affected module, public hint, and investigation direction.

Sanitized feedback must not include exact hidden inputs, exact expected outputs, fixture values, hidden file names, hidden case names, line numbers from hidden tests, full stack traces, validator prompts, or private paths.

The similarity guard compares hidden candidate summaries with executor public tests using token/Jaccard, purpose, input-class, and boundary overlap.
