import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createHookMarker, type HookMarker } from "../src/hookState.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { addManualSourceToReport, buildResearchReport, runResearch } from "../src/researchOrchestrator.js";
import { researchReportPath } from "../src/paths.js";

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
  report.generatedAt = new Date(Date.parse(marker.createdAt) + 1_000).toISOString();
  writeFileSync(researchReportPath(cwd), `${JSON.stringify(report, null, 2)}\n`);
}

describe("research runner reports", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("does not stop at matrix-only mode when manual fallback is used", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
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
    const report = buildResearchReport(prompt, [], "not_configured", { turnId: marker.turnId }) as unknown as Record<string, unknown>;
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
      sdkTimeoutMs: 1,
      input: { turnId: "turn-all-timeout" },
      sdkPromptRunner: () => new Promise<string>(() => undefined)
    });

    expect(stopValidationGate({ cwd, turnId: "turn-all-timeout" }).decision).toBe("block");
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
