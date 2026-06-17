import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { requireExecutorManifest } from "../src/executionOrchestrator.js";
import { createHookMarker } from "../src/hookState.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { nextLoopAction } from "../src/loopController.js";
import { executorManifestPath, validationSummaryPath } from "../src/paths.js";
import { updateRegressionBank } from "../src/validators/buildRegressionBank.js";
import { failedValidationSummary } from "../src/validators/runHiddenValidation.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";
import type { RouterOutput } from "../src/router/routerSchema.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-test-"));
  mkdirSync(join(dir, ".agent", "manifests"), { recursive: true });
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function validationRouterOutput(): RouterOutput {
  return {
    route: "validation_sensitive_implementation",
    workflowPattern: "repair_loop",
    researchProfile: "none",
    researchScope: "implementation_support",
    evidenceNeed: "external_sources_optional",
    localDiagnosisRequired: true,
    externalResearchRequired: false,
    exhaustiveCoverageRequired: false,
    validationProfile: "hidden_validation_with_final_holdout",
    sourceBuckets: [],
    requiredAgents: [{ name: "executor", required: true, reason: "Implementation requires executor manifest." }],
    requiresSourceMatrix: false,
    requiresExecutorManifest: true,
    requiresValidation: true,
    requiresFinalHoldout: true,
    requiresParallelIsolation: false,
    reasons: ["Router selected validation-sensitive implementation."],
    risks: ["may_need_hidden_validation"],
    bypass: { requested: false, reason: "" }
  };
}

describe("validation loop", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("fails implementation when executor_manifest is missing", () => {
    expect(() => requireExecutorManifest(tempRepo())).toThrow(/executor_manifest/);
  });

  it("continues repair on failed validation and updates regression bank privately", () => {
    const cwd = tempRepo();
    process.env.CODEX_HARDFLOW_PRIVATE_ROOT = join(tmpdir(), "hardflow-private-tests");
    const summary = failedValidationSummary(0, "boundary");
    expect(nextLoopAction(summary)).toBe("repair");
    const bank = updateRegressionBank(cwd, summary.categories);
    expect(bank.updated).toBe(true);
    expect(bank.count).toBe(1);
  });

  it("requires final holdout after hidden validation passes", () => {
    const summary = {
      ...failedValidationSummary(0, "boundary"),
      status: "passed" as const,
      hidden_status: "passed" as const,
      final_holdout_status: "not_run" as const,
      failed_count: 0,
      categories: []
    };
    expect(nextLoopAction(summary)).toBe("holdout");
  });

  it("stop hook blocks when manifest exists but validation is missing", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "fix production auth validation bug",
      sourceRoot: process.cwd(),
      taskType: "validation-sensitive",
      requiresSourceMatrix: false,
      requiresExecutorManifest: true,
      requiresValidation: true,
      input: { turnId: "turn-validation-missing" }
    });
    writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: "fix production auth validation bug", currentRunId: marker.runId }, validationRouterOutput(), "llm", undefined, marker.turnId));
    writeFileSync(executorManifestPath(cwd), JSON.stringify({ task_id: "x" }));
    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("block");
  });

  it("stop hook blocks repair on sanitized failure and allows final holdout passed", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "fix production auth validation bug",
      sourceRoot: process.cwd(),
      taskType: "validation-sensitive",
      requiresSourceMatrix: false,
      requiresExecutorManifest: true,
      requiresValidation: true,
      input: { turnId: "turn-validation-failure" }
    });
    writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: "fix production auth validation bug", currentRunId: marker.runId }, validationRouterOutput(), "llm", undefined, marker.turnId));
    writeFileSync(executorManifestPath(cwd), JSON.stringify({ task_id: "x" }));
    writeFileSync(validationSummaryPath(cwd), JSON.stringify(failedValidationSummary(0, "boundary")));
    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("block");
    writeFileSync(
      validationSummaryPath(cwd),
      JSON.stringify({
        ...failedValidationSummary(0, "boundary"),
        status: "passed",
        hidden_status: "passed",
        final_holdout_status: "passed",
        failed_count: 0,
        categories: []
      })
    );
    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("allow");
  });
});
