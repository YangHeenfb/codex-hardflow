import type { ValidationSummary } from "../schemas.js";
import { sanitizeValidationSummary } from "../sanitizer.js";

export function notConfiguredValidationSummary(iteration = 0): ValidationSummary {
  return {
    validation_id: `val-${Date.now()}`,
    iteration,
    status: "not_configured",
    public_status: "not_run",
    hidden_status: "not_configured",
    final_holdout_status: "not_run",
    failed_count: 0,
    categories: [],
    executor_manifest_read: true,
    hidden_tests_disclosed: false,
    regression_bank_updated: false,
    fresh_cases_generated: false,
    repair_loop_next_action: "done",
    next_repair_prompt: "Hidden validator is not configured; do not claim hidden validation coverage."
  };
}

export function failedValidationSummary(iteration: number, category: string): ValidationSummary {
  return sanitizeValidationSummary({
    validation_id: `val-${Date.now()}`,
    iteration,
    status: "failed",
    public_status: "passed",
    hidden_status: "failed",
    final_holdout_status: "not_run",
    failed_count: 1,
    categories: [
      {
        category,
        severity: "high",
        public_spec_reference: "public behavior contract",
        summary: "A private case failed in a broad input class.",
        public_hint: "Inspect handling for the affected category without assuming exact hidden inputs.",
        likely_affected_area: category,
        leakage_risk_checked: true
      }
    ],
    executor_manifest_read: true,
    hidden_tests_disclosed: false,
    regression_bank_updated: true,
    fresh_cases_generated: true,
    repair_loop_next_action: "repair",
    next_repair_prompt: `Repair public behavior for category ${category}; exact hidden cases remain private.`
  });
}
