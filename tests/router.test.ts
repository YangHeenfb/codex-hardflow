import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createHookMarker } from "../src/hookState.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { currentRouterTracePath, researchRunRouterTracePath, researchSubagentRouterTracePath } from "../src/paths.js";
import { runLlmRouter } from "../src/router/llmRouter.js";
import { normalizeRouterOutput } from "../src/router/routerNormalize.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";
import { parseRouterOutput, type RouterOutput, type RouterTrace } from "../src/router/routerSchema.js";
import { agentSecurityRouterOutput, currentProjectCompetitorRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-router-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  mkdirSync(join(dir, ".agent", "manifests"), { recursive: true });
  return dir;
}

function directOutput(): RouterOutput {
  return {
    route: "direct_answer",
    workflowPattern: "direct",
    researchProfile: "none",
    validationProfile: "none",
    sourceBuckets: [],
    requiredAgents: [],
    requiresSourceMatrix: false,
    requiresExecutorManifest: false,
    requiresValidation: false,
    requiresFinalHoldout: false,
    requiresParallelIsolation: false,
    reasons: ["Simple direct answer."],
    risks: [],
    bypass: { requested: false, reason: "" }
  };
}

function implementationOutput(overrides: Partial<RouterOutput> = {}): RouterOutput {
  return {
    ...directOutput(),
    route: "implementation",
    workflowPattern: "sequential_pipeline",
    validationProfile: "manifest_only",
    requiredAgents: [{ name: "executor", required: true, reason: "Code changes require executor manifest." }],
    requiresExecutorManifest: true,
    reasons: ["Implementation requested."],
    ...overrides
  };
}

function malformedResearchOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    route: "research",
    workflowPattern: "parallel_research",
    researchProfile: "local_repo_plus_external",
    validationProfile: "none",
    sourceBuckets: ["local_repo", "competitors"],
    requiredAgents: ["local_repo_researcher", "competitor_researcher"],
    requiresSourceMatrix: true,
    requiresExecutorManifest: false,
    requiresValidation: false,
    requiresFinalHoldout: false,
    requiresParallelIsolation: false,
    bypass: false,
    ...overrides
  };
}

async function routeWith(output: RouterOutput, prompt: string, cwd: string, runId = "run-router-test") {
  return runLlmRouter(
    { rawUserPrompt: prompt, currentRunId: runId },
    {
      cwd,
      promptRunner: async () => JSON.stringify(output),
      turnId: "turn-router-test",
      writeTrace: true
    }
  );
}

describe("LLM router", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("routes Chinese current-project competitor prompt to local_repo_plus_external", async () => {
    const cwd = tempRepo();
    const { output } = await routeWith(
      currentProjectCompetitorRouterOutput,
      "我现在这个项目做的multi agent结构有什么类似的产品或者项目？有哪些我可以吸收改进的？",
      cwd
    );

    expect(output.route).toBe("research");
    expect(output.researchProfile).toBe("local_repo_plus_external");
    expect(output.sourceBuckets.find((bucket) => bucket.bucket === "competitors")?.status).toBe("required");
    expect(output.sourceBuckets.find((bucket) => bucket.bucket === "local_repo")?.status).toBe("required");
  });

  it("routes broad-source AI coding agent question to broad research buckets", async () => {
    const cwd = tempRepo();
    const { output } = await routeWith(
      agentSecurityRouterOutput,
      "What are current practical solutions for broad-source multi-agent research and hidden validation in AI coding agents?",
      cwd
    );

    expect(output.route).toBe("research");
    expect(output.sourceBuckets.map((bucket) => bucket.bucket)).toEqual(
      expect.arrayContaining(["official_docs", "github", "community", "academic", "security", "package_registry", "codex_default_discovery"])
    );
  });

  it("routes simple translation and casual chat to direct answers", async () => {
    const cwd = tempRepo();
    expect((await routeWith(directOutput(), "translate hello to Chinese", cwd)).output.route).toBe("direct_answer");
    expect((await routeWith(directOutput(), "hi, how are you?", cwd)).output.requiresSourceMatrix).toBe(false);
  });

  it("routes implementation, hidden validation, and parallel module requests through router fields", async () => {
    const cwd = tempRepo();
    const implementation = await routeWith(implementationOutput(), "implement a new CLI command", cwd);
    const hidden = await routeWith(
      implementationOutput({
        route: "validation_sensitive_implementation",
        workflowPattern: "repair_loop",
        validationProfile: "hidden_validation_with_final_holdout",
        requiresValidation: true,
        requiresFinalHoldout: true,
        reasons: ["Hidden validation requested."],
        risks: ["may_need_hidden_validation"]
      }),
      "implement this with hidden validation and final holdout",
      cwd
    );
    const parallel = await routeWith(
      {
        ...directOutput(),
        route: "parallel_modules",
        workflowPattern: "parallel_modules",
        requiresParallelIsolation: true,
        reasons: ["Independent path_scope modules requested."],
        risks: ["may_need_parallel_isolation"]
      },
      "split this into independent modules with path_scope isolation",
      cwd
    );

    expect(implementation.output.requiresExecutorManifest).toBe(true);
    expect(hidden.output.requiresValidation).toBe(true);
    expect(hidden.output.requiresFinalHoldout).toBe(true);
    expect(parallel.output.requiresParallelIsolation).toBe(true);
  });

  it("uses semantic bypass from router output", async () => {
    const cwd = tempRepo();
    const bypass = await routeWith(
      { ...directOutput(), route: "bypass", bypass: { requested: true, reason: "User asked for a quick answer." } },
      "please give me a quick answer without hardflow",
      cwd
    );
    expect(bypass.output.route).toBe("bypass");
    expect(bypass.trace.routerMode).toBe("semantic_bypass");
  });

  it("normalizes string buckets, string agents, boolean bypass, and missing optional arrays", () => {
    const normalized = normalizeRouterOutput(malformedResearchOutput());
    const output = parseRouterOutput(normalized.normalized);

    expect(output.route).toBe("research");
    expect(output.sourceBuckets).toEqual([
      { bucket: "local_repo", status: "required", reason: "Normalized from router string bucket." },
      { bucket: "competitors", status: "required", reason: "Normalized from router string bucket." }
    ]);
    expect(output.requiredAgents).toEqual([
      { name: "local_repo_researcher", required: true, reason: "Normalized from router string agent." },
      { name: "competitor_researcher", required: true, reason: "Normalized from router string agent." }
    ]);
    expect(output.bypass).toEqual({ requested: false, reason: "Router returned boolean bypass=false." });
    expect(output.risks).toEqual([]);
    expect(output.reasons[0]).toContain("normalized");
  });

  it("normalizes missing bucket and agent fields without changing route intent", () => {
    const normalized = normalizeRouterOutput(
      malformedResearchOutput({
        sourceBuckets: [{ bucket: "official_docs" }],
        requiredAgents: [{ name: "official_docs_researcher" }],
        reasons: ["Original semantic research route."],
        risks: []
      })
    );
    const output = parseRouterOutput(normalized.normalized);

    expect(output.route).toBe("research");
    expect(output.researchProfile).toBe("local_repo_plus_external");
    expect(output.sourceBuckets[0]).toEqual({ bucket: "official_docs", status: "required", reason: "Normalized from router bucket." });
    expect(output.requiredAgents[0]).toEqual({ name: "official_docs_researcher", required: true, reason: "Normalized from router agent." });
    expect(output.reasons).toEqual(["Original semantic research route."]);
  });

  it("drops invalid source buckets with warnings", () => {
    const normalized = normalizeRouterOutput(
      malformedResearchOutput({
        sourceBuckets: ["official_docs", "made_up_bucket"],
        reasons: ["Research route."],
        risks: []
      })
    );
    const output = parseRouterOutput(normalized.normalized);

    expect(output.sourceBuckets.map((bucket) => bucket.bucket)).toEqual(["official_docs"]);
    expect(normalized.warnings).toContain("invalid source bucket: made_up_bucket");
    expect(output.diagnostics?.normalizationWarnings).toContain("invalid source bucket: made_up_bucket");
  });

  it("uses normalized router output instead of router_failed when shape repair is sufficient", async () => {
    const cwd = tempRepo();
    const result = await runLlmRouter(
      { rawUserPrompt: "找类似 multi agent 产品", currentRunId: "run-normalized" },
      { cwd, promptRunner: async () => JSON.stringify(malformedResearchOutput()), writeTrace: true }
    );

    expect(result.output.route).toBe("research");
    expect(result.output.diagnostics?.normalized).toBe(true);
    expect(result.output.sourceBuckets.map((bucket) => bucket.bucket)).toEqual(["local_repo", "competitors"]);
  });

  it("uses one schema repair retry only after parse and normalization fail", async () => {
    const cwd = tempRepo();
    const responses = [
      JSON.stringify(
        malformedResearchOutput({
          requiredAgents: [{ name: "executor", required: false }],
          reasons: ["Implementation planning route."],
          risks: []
        })
      ),
      JSON.stringify(implementationOutput())
    ];
    let calls = 0;
    const result = await runLlmRouter(
      { rawUserPrompt: "design hidden validator runner plan", currentRunId: "run-repair" },
      {
        cwd,
        promptRunner: async () => responses[calls++] ?? responses.at(-1) ?? "{}",
        writeTrace: false
      }
    );

    expect(calls).toBe(2);
    expect(result.output.route).toBe("implementation");
    expect(result.output.diagnostics?.repairRetryUsed).toBe(true);
    expect(result.output.route).not.toBe("router_failed");
  });

  it("produces router_failed when schema repair retry also fails", async () => {
    const cwd = tempRepo();
    let calls = 0;
    const result = await runLlmRouter(
      { rawUserPrompt: "design hidden validator runner plan", currentRunId: "run-repair-fail" },
      {
        cwd,
        promptRunner: async () => {
          calls += 1;
          return JSON.stringify(
            malformedResearchOutput({
              requiredAgents: [{ name: "executor", required: false }],
              reasons: ["Still malformed."],
              risks: []
            })
          );
        },
        writeTrace: false
      }
    );

    expect(calls).toBe(2);
    expect(result.output.route).toBe("router_failed");
    expect(result.trace.fallbackReason).toContain("repair retry");
  });

  it("invalid JSON and timeout produce router_failed without keyword fallback", async () => {
    const cwd = tempRepo();
    const invalid = await runLlmRouter({ rawUserPrompt: "research current AI agents", currentRunId: "run-invalid" }, { cwd, promptRunner: async () => "not json" });
    const timeout = await runLlmRouter(
      { rawUserPrompt: "research current AI agents", currentRunId: "run-timeout" },
      { cwd, timeoutMs: 1, promptRunner: async () => new Promise<string>(() => undefined) }
    );

    expect(invalid.output.route).toBe("router_failed");
    expect(timeout.output.route).toBe("router_failed");
    expect(invalid.output.reasons[0]).toContain("no keyword fallback");
  });

  it("writes router_trace to the run-owned path", async () => {
    const cwd = tempRepo();
    await routeWith(routerOutputForBuckets(["official_docs", "github", "codex_default_discovery"]), "research current docs", cwd, "run-trace-path");
    expect(existsSync(researchRunRouterTracePath(cwd, "run-trace-path"))).toBe(true);
  });

  it("parent router_trace writes run path and updates current pointer", async () => {
    const cwd = tempRepo();
    await routeWith(routerOutputForBuckets(["official_docs"]), "research docs", cwd, "run-parent-trace");
    const runTrace = JSON.parse(readFileSync(researchRunRouterTracePath(cwd, "run-parent-trace"), "utf8")) as RouterTrace;
    const currentTrace = JSON.parse(readFileSync(currentRouterTracePath(cwd), "utf8")) as RouterTrace;

    expect(runTrace.owner).toBe("parent");
    expect(currentTrace.owner).toBe("parent");
    expect(currentTrace.runId).toBe("run-parent-trace");
  });

  it("subagent router_trace writes under subagents and cannot overwrite current", async () => {
    const cwd = tempRepo();
    await routeWith(routerOutputForBuckets(["official_docs"]), "parent research", cwd, "run-parent-current");
    await runLlmRouter(
      { rawUserPrompt: "local repo subtask", currentRunId: "run-child-route" },
      {
        cwd,
        promptRunner: async () => JSON.stringify(routerOutputForBuckets(["local_repo"])),
        owner: "subagent",
        parentRunId: "run-parent-current",
        subagentName: "local_repo_researcher",
        bucket: "local_repo",
        writeTrace: true
      }
    );

    expect(existsSync(researchSubagentRouterTracePath(cwd, "run-parent-current", "local_repo_researcher", "local_repo"))).toBe(true);
    const currentTrace = JSON.parse(readFileSync(currentRouterTracePath(cwd), "utf8")) as RouterTrace;
    expect(currentTrace.owner).toBe("parent");
    expect(currentTrace.runId).toBe("run-parent-current");
    expect(currentTrace.rawUserPrompt).toBe("parent research");
  });

  it("Stop hook ignores subagent router_trace for the parent gate", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "research current multi-agent products",
      sourceRoot: process.cwd(),
      taskType: "router-preflight",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-router-subagent-only" }
    });
    writeRouterTrace(
      cwd,
      buildRouterTrace(
        { rawUserPrompt: "local repo subtask", currentRunId: "child-run" },
        routerOutputForBuckets(["local_repo"]),
        "llm",
        undefined,
        marker.turnId,
        { owner: "subagent", parentRunId: marker.runId, subagentName: "local_repo_researcher", bucket: "local_repo" }
      )
    );

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("block");
    expect(String(result.reason)).toContain("router_trace");
  });

  it("Stop hook uses routerOutput and does not reclassify by keyword", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "fix hidden validation bug but router says direct",
      sourceRoot: process.cwd(),
      taskType: "router-preflight",
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-router-controls-stop" }
    });
    writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: "fix hidden validation bug but router says direct", currentRunId: marker.runId }, directOutput(), "llm", undefined, marker.turnId));

    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("allow");
  });
});
