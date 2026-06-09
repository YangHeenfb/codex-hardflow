import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_LOOP_CONFIG } from "./config.js";
import { readExecutorManifest } from "./executionOrchestrator.js";
import { validationSummaryPath } from "./paths.js";
import type { ValidationSummary } from "./schemas.js";
import { updateRegressionBank } from "./validators/buildRegressionBank.js";
import { buildFinalHoldout } from "./validators/buildFinalHoldout.js";
import { generateHiddenTests } from "./validators/generateHiddenTests.js";
import { notConfiguredValidationSummary } from "./validators/runHiddenValidation.js";

export function writeValidationSummary(cwd: string, summary: ValidationSummary): ValidationSummary {
  const target = validationSummaryPath(cwd);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export function validate(cwd: string): ValidationSummary {
  const manifest = readExecutorManifest(cwd);
  generateHiddenTests(cwd, manifest.task_id, manifest, DEFAULT_LOOP_CONFIG.fresh_cases_per_cycle);
  buildFinalHoldout(cwd, DEFAULT_LOOP_CONFIG.min_holdout_cases);
  const summary = notConfiguredValidationSummary(0);
  return writeValidationSummary(cwd, summary);
}

export function recordFailedValidation(cwd: string, summary: ValidationSummary): ValidationSummary {
  updateRegressionBank(cwd, summary.categories);
  return writeValidationSummary(cwd, { ...summary, regression_bank_updated: true });
}
