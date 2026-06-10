import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createHookMarker, type HookMarker } from "../src/hookState.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { addManualSourceToReport, addSubagentReport, assertResearchReportEvidence, buildResearchReport, loadResearchReport, mergeSubagentReports, runResearch } from "../src/researchOrchestrator.js";
import { currentResearchReportPath, researchReportPath, researchRunReportPath, researchRunRouterTracePath, researchSubagentReportPath } from "../src/paths.js";
import { agentSecurityRouterOutput, broadResearchRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";
import type { RouterOutput, RouterTrace } from "../src/router/routerSchema.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-research-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
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

function writeReport(cwd: string, marker: HookMarker, report: Record<string, unknown>): void {
  report.runId = marker.runId;
  report.owner = report.owner ?? "parent";
  report.generatedAt = new Date(Date.parse(marker.createdAt) + 1_000).toISOString();
  for (const target of [researchRunReportPath(cwd, marker.runId), currentResearchReportPath(cwd)]) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  const routerOutput = ((report.source_matrix as Record<string, unknown> | undefined)?.routerOutput ?? broadResearchRouterOutput) as RouterOutput;
  writeRouterTrace(
    cwd,
    buildRouterTrace({ rawUserPrompt: String(report.rawUserPrompt ?? report.task ?? ""), currentRunId: marker.runId }, routerOutput, "llm", undefined, marker.turnId),
    true
  );
}

describe("research runner reports", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("does not stop at matrix-only mode when manual fallback is used", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "manual_fallback",
      manualFallbackReason: "SDK unavailable in test",
      input: { turnId: "turn-manual-runner" }
    });

    expect(report.runner_mode).toBe("manual_fallback");
    expect(report.manual_fallback_reason).toBe("SDK unavailable in test");
    expect(report.agent_runs.length).toBeGreaterThan(0);
    expect(Object.keys(report.bucket_statuses)).toContain("codex_default_discovery");
    expect(JSON.parse(readFileSync(researchReportPath(cwd), "utf8")).agent_runs.length).toBeGreaterThan(0);
  });

  it("records agent timeouts including codex_default_researcher timeout", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "sdk_threads",
      sdkTimeoutMs: 1,
      input: { turnId: "turn-timeout-runner" },
      sdkPromptRunner: () => new Promise<string>(() => undefined)
    });

    expect(report.agent_runs.some((run) => run.status === "timeout")).toBe(true);
    expect(report.codex_default_discovery_status).toBe("timeout");
    expect(report.status).toBe("failed");
  });

  it("records package/security context exhaustion", async () => {
    const cwd = tempRepo();
    const report = await runResearch("troubleshoot the latest Next.js auth package error", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: routerOutputForBuckets(["official_docs", "github", "community", "package_registry", "security", "codex_default_discovery"]),
      runnerMode: "sdk_threads",
      input: { turnId: "turn-context-exhausted" },
      sdkPromptRunner: async (_prompt, _cwd, bucket) => {
        if (bucket === "package_registry" || bucket === "security") {
          throw new Error("context exhausted while researching package security");
        }
        return validRunnerJson(bucket);
      }
    });

    expect(report.agent_runs.filter((run) => run.bucket === "package_registry" || run.bucket === "security").map((run) => run.status)).toEqual([
      "context_exhausted",
      "context_exhausted"
    ]);
    expect(report.bucket_statuses.package_security).toBe("context_exhausted");
  });

  it("Stop gate rejects research reports missing agent_runs", () => {
    const cwd = tempRepo();
    const prompt = "research current agent framework choices";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-missing-agent-runs" }
    });
    const report = buildResearchReport(prompt, [], "not_configured", { turnId: marker.turnId, runId: marker.runId, routerOutput: broadResearchRouterOutput }) as unknown as Record<string, unknown>;
    delete report.agent_runs;
    writeReport(cwd, marker, report);

    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("block");
  });

  it("Stop gate blocks available-subagent manual fallback without subagent or SDK runs", () => {
    const cwd = tempRepo();
    const prompt = "research current agent framework choices";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-subagent-available-manual" }
    });
    const report = buildResearchReport(prompt, [], "not_configured", {
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput: broadResearchRouterOutput,
      runnerMode: "manual_fallback",
      manualFallbackReason: "manual search used despite available subagent capability",
      subagentStatus: "available"
    }) as unknown as Record<string, unknown>;
    writeReport(cwd, marker, report);

    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("block");
  });

  it("manual backfill adds sources and can satisfy evidence gate for mixed research", async () => {
    const cwd = tempRepo();
    const prompt = "research current agent framework choices";
    await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "sdk_threads",
      input: { turnId: "turn-manual-backfill" },
      sdkPromptRunner: async (_prompt, _cwd, bucket) => validRunnerJson(bucket)
    });

    addManualSourceToReport(cwd, {
      bucket: "official_docs",
      title: "Official docs",
      url_or_ref: "https://example.com/docs",
      claim: "Official documentation reviewed.",
      finding: "Official docs provide primary evidence."
    });
    addManualSourceToReport(cwd, {
      bucket: "github",
      title: "GitHub repo",
      url_or_ref: "https://github.com/example/repo",
      claim: "Repository evidence reviewed.",
      finding: "GitHub provides implementation evidence."
    });
    const report = addManualSourceToReport(cwd, {
      bucket: "codex_default_discovery",
      title: "Default discovery source",
      url_or_ref: "https://example.com/default",
      claim: "Default discovery evidence reviewed.",
      finding: "Default discovery adds corroborating evidence."
    });

    expect(report.runner_mode).toBe("mixed");
    expect(report.bucket_statuses.official_docs).toBe("manual_backfilled");
    expect(report.searched_sources_table.length).toBe(3);
    expect(stopValidationGate({ cwd, turnId: "turn-manual-backfill" }).decision).toBe("allow");
  });

  it("Stop gate fails all-timeout and empty-evidence reports", async () => {
    const cwd = tempRepo();
    const prompt = "research current agent framework choices";
    await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "sdk_threads",
      sdkTimeoutMs: 1,
      input: { turnId: "turn-all-timeout" },
      sdkPromptRunner: () => new Promise<string>(() => undefined)
    });

    expect(stopValidationGate({ cwd, turnId: "turn-all-timeout" }).decision).toBe("block");
  });

  it("app_handoff initializes a report without starting SDK threads and blocks without evidence", async () => {
    const cwd = tempRepo();
    let sdkCalls = 0;
    const report = await runResearch("research current AI coding agent evaluation approaches", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-app-handoff-empty" },
      sdkPromptRunner: async () => {
        sdkCalls += 1;
        return "{}";
      }
    });

    expect(report.runner_mode).toBe("app_handoff");
    expect(report.app_handoff_required).toBe(true);
    expect(report.sdk_threads_started).toBe(false);
    expect(report.sdk_threads_allowed).toBe(false);
    expect(report.subagent_instruction_injected).toBe(true);
    expect(report.manual_backfill_required).toBe(true);
    expect(sdkCalls).toBe(0);
    const gate = stopValidationGate({ cwd, turnId: "turn-app-handoff-empty" });
    expect(gate.decision).toBe("block");
    expect(String(gate.reason)).toContain("Spawn App subagents");
  });

  it("app_handoff creates a runId and writes parent report to runs plus current copy", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current AI coding agent evaluation approaches", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: agentSecurityRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-run-owned" }
    });

    expect(report.runId).toBe("run-turn-run-owned");
    expect(report.owner).toBe("parent");
    expect(existsSync(researchRunReportPath(cwd, report.runId))).toBe(true);
    expect(existsSync(currentResearchReportPath(cwd))).toBe(true);
    expect(JSON.parse(readFileSync(currentResearchReportPath(cwd), "utf8")).runId).toBe(report.runId);
  });

  it("route then research with the same runId reuses the parent router_trace", async () => {
    const cwd = tempRepo();
    const prompt = "research current agent framework choices";
    const runId = "run-reuse-router-trace";
    writeRouterTrace(
      cwd,
      buildRouterTrace({ rawUserPrompt: prompt, normalizedTask: prompt, currentRunId: runId }, broadResearchRouterOutput, "llm", undefined, "turn-route-first"),
      true
    );
    const before = readFileSync(researchRunRouterTracePath(cwd, runId), "utf8");

    const report = await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      runId,
      runnerMode: "app_handoff",
      input: { turnId: "turn-reuse-router-trace" }
    });

    expect(report.router_trace_reused).toBe(true);
    expect(report.router_trace_path).toBe(researchRunRouterTracePath(cwd, runId));
    expect(report.source_matrix.routerStatus).toBe("available");
    expect(report.required_buckets).toEqual(expect.arrayContaining(["official_docs", "github", "community", "codex_default_discovery"]));
    expect(readFileSync(researchRunRouterTracePath(cwd, runId), "utf8")).toBe(before);
  });

  it("stale router_trace with a different promptHash is not reused", async () => {
    const cwd = tempRepo();
    const runId = "run-stale-router-trace";
    writeRouterTrace(
      cwd,
      buildRouterTrace({ rawUserPrompt: "research stale task", normalizedTask: "research stale task", currentRunId: runId }, broadResearchRouterOutput, "llm", undefined, "turn-stale-route"),
      true
    );

    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      runId,
      runnerMode: "app_handoff",
      input: { turnId: "turn-stale-router-trace" }
    });

    expect(report.router_trace_reused).toBe(false);
    expect(report.router_trace_stale_reason).toContain("does not match");
    expect(report.source_matrix.routerStatus).toBe("unavailable");
    const trace = JSON.parse(readFileSync(researchRunRouterTracePath(cwd, runId), "utf8")) as RouterTrace;
    expect(trace.route).toBe("router_failed");
  });

  it("subagent-owned router_trace is not reused as a parent trace", async () => {
    const cwd = tempRepo();
    const prompt = "research current agent framework choices";
    const runId = "run-subagent-owned-trace";
    const trace = buildRouterTrace(
      { rawUserPrompt: prompt, normalizedTask: prompt, currentRunId: runId },
      broadResearchRouterOutput,
      "llm",
      undefined,
      "turn-subagent-owned",
      { owner: "subagent", parentRunId: runId, subagentName: "local_repo_researcher", bucket: "local_repo" }
    );
    mkdirSync(join(cwd, ".agent", "reports", "runs", runId), { recursive: true });
    writeFileSync(researchRunRouterTracePath(cwd, runId), `${JSON.stringify(trace, null, 2)}\n`);

    const report = await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      runId,
      runnerMode: "app_handoff",
      input: { turnId: "turn-subagent-trace-not-reused" }
    });

    expect(report.router_trace_reused).toBe(false);
    expect(report.router_trace_stale_reason).toContain("subagent-owned");
  });

  it("runRouter=true explicitly reruns router and replaces an existing parent trace", async () => {
    const cwd = tempRepo();
    const prompt = "research current AI coding agent security evaluation";
    const runId = "run-explicit-router-rerun";
    writeRouterTrace(
      cwd,
      buildRouterTrace({ rawUserPrompt: prompt, normalizedTask: prompt, currentRunId: runId }, broadResearchRouterOutput, "llm", undefined, "turn-old-route"),
      true
    );

    const report = await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      runId,
      runnerMode: "app_handoff",
      runRouter: true,
      routerPromptRunner: async () => JSON.stringify(agentSecurityRouterOutput),
      input: { turnId: "turn-explicit-router-rerun" }
    });

    expect(report.router_trace_reused).toBe(false);
    expect(report.router_trace_reuse_reason).toContain("replaced");
    expect(report.required_buckets).toContain("security");
    const trace = JSON.parse(readFileSync(researchRunRouterTracePath(cwd, runId), "utf8")) as RouterTrace;
    expect(trace.promptHash).toBe(report.promptHash);
    expect(trace.sourceBuckets.map((bucket) => bucket.bucket)).toContain("security");
  });

  it("records not_spawned subagent status with a skip reason", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      subagentStatus: "not_spawned",
      subagentSkipReason: "App subagent runtime was disabled in this test.",
      input: { turnId: "turn-subagents-not-spawned" }
    });

    expect(report.subagent_status).toBe("not_spawned");
    expect(report.subagent_skip_reason).toBe("App subagent runtime was disabled in this test.");
  });

  it("subagent report cannot overwrite parent report and only merges through parent flow", async () => {
    const cwd = tempRepo();
    const parent = await runResearch("research current onboarding patterns for product teams", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-subagent-isolated" }
    });
    const parentBefore = readFileSync(researchRunReportPath(cwd, parent.runId), "utf8");

    const subagent = addSubagentReport(cwd, {
      parentRunId: parent.runId,
      agent: "official_docs_researcher",
      bucket: "official_docs",
      status: "completed",
      sources_found: [
        {
          bucket: "official_docs",
          title: "Official docs",
          source_type: "official_docs",
          url_or_ref: "https://example.com/docs",
          date_or_version: "2026-06-09",
          claim: "Official docs reviewed.",
          confidence: "high",
          notes: "Subagent result."
        }
      ],
      queries_run: ["official docs query"]
    });

    expect(existsSync(researchSubagentReportPath(cwd, parent.runId, "official_docs_researcher", "official_docs"))).toBe(true);
    expect(subagent.parentRunId).toBe(parent.runId);
    expect(readFileSync(researchRunReportPath(cwd, parent.runId), "utf8")).toBe(parentBefore);

    const merged = mergeSubagentReports(cwd, parent.runId);
    expect(merged.searched_sources_table).toHaveLength(1);
    expect(merged.mergedSubagentReports).toContain("official_docs_researcher-official_docs.json");
    expect(loadResearchReport(cwd, parent.runId).searched_sources_table).toHaveLength(1);
  });

  it("app_handoff with manual_backfilled critical sources passes the Stop gate", async () => {
    const cwd = tempRepo();
    const prompt = "research current onboarding patterns for product teams";
    await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-app-handoff-backfilled" }
    });

    addManualSourceToReport(cwd, {
      bucket: "official_docs",
      title: "Official docs",
      url_or_ref: "https://example.com/docs",
      claim: "Official documentation was reviewed.",
      finding: "Official docs provide primary evidence."
    });
    addManualSourceToReport(cwd, {
      bucket: "github",
      title: "GitHub repo",
      url_or_ref: "https://github.com/example/repo",
      claim: "Repository evidence was reviewed.",
      finding: "GitHub provides implementation evidence."
    });
    addManualSourceToReport(cwd, {
      bucket: "codex_default_discovery",
      title: "Default discovery",
      url_or_ref: "https://example.com/default",
      claim: "Default discovery was reviewed.",
      finding: "Default discovery adds corroborating evidence."
    });

    expect(stopValidationGate({ cwd, turnId: "turn-app-handoff-backfilled" }).decision).toBe("allow");
  });

  it("sdk_threads all-timeout reports fail the evidence assertion", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "sdk_threads",
      sdkTimeoutMs: 1,
      input: { turnId: "turn-assert-all-timeout" },
      sdkPromptRunner: () => new Promise<string>(() => undefined)
    });

    expect(assertResearchReportEvidence(report).passed).toBe(false);
  });

  it("starts SDK threads only when sdk_threads or executeSdkResearch is explicit", async () => {
    const cwd = tempRepo();
    let sdkCalls = 0;
    const defaultReport = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      input: { turnId: "turn-default-app-handoff" },
      sdkPromptRunner: async (_prompt, _cwd, bucket) => {
        sdkCalls += 1;
        return validRunnerJson(bucket);
      }
    });
    expect(defaultReport.runner_mode).toBe("app_handoff");
    expect(sdkCalls).toBe(0);

    await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      executeSdkResearch: true,
      input: { turnId: "turn-explicit-sdk" },
      sdkPromptRunner: async (_prompt, _cwd, bucket) => {
        sdkCalls += 1;
        return validRunnerJson(bucket);
      }
    });
    expect(sdkCalls).toBeGreaterThan(0);
  });

  it("Stop gate records timeout-only codex_default_discovery but does not treat it as enough evidence", () => {
    const cwd = tempRepo();
    const prompt = "research current agent framework choices";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-default-timeout-only" }
    });
    const generatedAt = new Date(Date.parse(marker.createdAt) + 1_000).toISOString();
    const report = buildResearchReport(prompt, [], "timeout", {
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput: broadResearchRouterOutput,
      generatedAt,
      agentRuns: [
        {
          agent: "codex_default_researcher",
          bucket: "codex_default_discovery",
          status: "timeout",
          startedAt: generatedAt,
          endedAt: generatedAt,
          queries_run: ["default query"],
          sources_found_count: 0,
          searched_but_no_signal: false,
          failure_reason: "timeout",
          fallback_used: false
        }
      ],
      bucketStatuses: { codex_default_discovery: "timeout" }
    }) as unknown as Record<string, unknown>;
    writeReport(cwd, marker, report);

    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("block");
  });
});
