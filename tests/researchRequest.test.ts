import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createHookMarker, type HookMarker } from "../src/hookState.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { executorManifestPath, researchRunReportPath } from "../src/paths.js";
import {
  createResearchRequest,
  listResearchRequests,
  resolveResearchRequest,
  runResearchRequest
} from "../src/research/researchRequest.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";
import { routerOutputForBuckets } from "./routerFixtures.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-research-request-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  mkdirSync(join(dir, ".agent", "manifests"), { recursive: true });
  return dir;
}

function markerWithTrace(cwd: string, turnId: string): HookMarker {
  const prompt = "implement feature with possible external docs";
  const marker = createHookMarker({
    cwd,
    prompt,
    sourceRoot: process.cwd(),
    taskType: "implementation",
    requiresSourceMatrix: false,
    requiresExecutorManifest: false,
    requiresValidation: false,
    input: { turnId }
  });
  writeRouterTrace(
    cwd,
    buildRouterTrace(
      { rawUserPrompt: prompt, currentRunId: marker.runId },
      routerOutputForBuckets([], {
        route: "implementation",
        workflowPattern: "sequential_pipeline",
        researchProfile: "none",
        requiresSourceMatrix: false,
        requiresExecutorManifest: false
      }),
      "llm",
      undefined,
      marker.turnId
    )
  );
  return marker;
}

function validRunnerJson(bucket: string): string {
  return JSON.stringify({
    bucket,
    queries_run: [`${bucket} query`],
    sources_found: [],
    searched_but_no_signal: true,
    uncertainties: [],
    recommended_followups: []
  });
}

describe("ResearchRequest", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("creates, lists, resolves, and gates blocking requests", () => {
    const cwd = tempRepo();
    const marker = markerWithTrace(cwd, "turn-request-block");
    const request = createResearchRequest(cwd, {
      runId: marker.runId,
      requestId: "docs-needed",
      requestedBy: "executor",
      stage: "execution",
      reason: "Need API behavior before editing.",
      question: "Find official API behavior.",
      requiredBuckets: ["official_docs"],
      urgency: "blocking"
    });

    expect(listResearchRequests(cwd, marker.runId).map((item) => item.requestId)).toEqual(["docs-needed"]);
    const blocked = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(blocked.decision).toBe("block");
    expect(String(blocked.reason)).toContain("blocking ResearchRequest");

    resolveResearchRequest(cwd, {
      runId: marker.runId,
      requestId: request.requestId,
      status: "resolved",
      linkedResearchRunId: "linked-run"
    });
    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("allow");
  });

  it("executor_manifest externalResearchNeeded blocks without a resolved linked request", () => {
    const cwd = tempRepo();
    const marker = markerWithTrace(cwd, "turn-manifest-research-needed");
    writeFileSync(
      executorManifestPath(cwd),
      `${JSON.stringify(
        {
          task_id: "task",
          changed_files: [],
          implementation_summary: "",
          assumptions: [],
          public_tests_added: [],
          public_tests_run: [],
          manual_checks: [],
          case_coverage_summary: { covered_equivalence_classes: [], covered_boundaries: [], covered_error_paths: [], not_covered: [] },
          risk_areas: [],
          known_limitations: [],
          externalResearchNeeded: true,
          unresolvedResearchRequests: []
        },
        null,
        2
      )}\n`
    );
    const updated = createHookMarker({
      cwd,
      prompt: "implementation needs docs",
      sourceRoot: process.cwd(),
      taskType: "implementation",
      requiresSourceMatrix: false,
      requiresExecutorManifest: true,
      requiresValidation: false,
      input: { turnId: "turn-manifest-research-needed-2" }
    });
    writeRouterTrace(
      cwd,
      buildRouterTrace(
        { rawUserPrompt: "implementation needs docs", currentRunId: updated.runId },
        routerOutputForBuckets([], {
          route: "implementation",
          workflowPattern: "sequential_pipeline",
          researchProfile: "none",
          requiresSourceMatrix: false,
          requiresExecutorManifest: true
        }),
        "llm",
        undefined,
        updated.turnId
      )
    );

    const result = stopValidationGate({ cwd, turnId: updated.turnId });
    expect(result.decision).toBe("block");
    expect(String(result.reason)).toContain("no resolved linked strict ResearchRequest");
  });

  it("runs a request through linked strict exhaustive all_required research", async () => {
    const cwd = tempRepo();
    const request = createResearchRequest(cwd, {
      runId: "parent-run",
      requestId: "sdk-docs",
      requestedBy: "executor",
      stage: "execution",
      reason: "Need source-backed docs.",
      question: "Find official docs for SDK behavior.",
      requiredBuckets: ["official_docs"],
      urgency: "blocking"
    });

    const resolved = await runResearchRequest(cwd, "parent-run", request.requestId, {
      sourceRoot: process.cwd(),
      sdkAvailable: true,
      sdkPromptRunner: async (_prompt, _cwd, bucket) => validRunnerJson(bucket)
    });
    const report = JSON.parse(readFileSync(researchRunReportPath(cwd, resolved.linkedResearchRunId ?? ""), "utf8")) as Record<string, unknown>;

    expect(resolved.status).toBe("resolved");
    expect(report.runner_mode).toBe("strict_programmatic");
    expect(report.coverageMode).toBe("exhaustive");
    expect(report.parallelPolicy).toBe("all_required");
  });
});
