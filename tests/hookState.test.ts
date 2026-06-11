import { dirname } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { createHookMarker, markerPathFor, updateMarker, type HookMarker } from "../src/hookState.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { addManualSourceToReport, buildResearchReport, runResearch } from "../src/researchOrchestrator.js";
import { currentResearchReportPath, legacyResearchReportPath, repoHash, researchRunReportPath } from "../src/paths.js";
import { broadResearchRouterOutput } from "./routerFixtures.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-hook-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  mkdirSync(join(dir, ".agent", "manifests"), { recursive: true });
  return dir;
}

function writeReport(cwd: string, marker: HookMarker, prompt: string, generatedAt?: string): void {
  const report = buildResearchReport(prompt, [], "not_configured", { runId: marker.runId, turnId: marker.turnId, routerOutput: broadResearchRouterOutput });
  report.generatedAt = generatedAt ?? new Date(Date.parse(marker.createdAt) + 1_000).toISOString();
  for (const target of [researchRunReportPath(cwd, marker.runId), currentResearchReportPath(cwd)]) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: prompt, currentRunId: marker.runId }, broadResearchRouterOutput, "llm", undefined, marker.turnId));
}

describe("hook marker Stop gate", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("UserPromptSubmit writes a turn-scoped marker with the required schema", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "research current AI coding agent hidden validation sandbox evaluation framework",
        turnId: "turn-schema",
        sessionId: "thread-schema"
      },
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    const context = String((result.hookSpecificOutput as Record<string, unknown>).additionalContext);
    expect((result.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(context).toContain("router_trace");
    expect(context).toContain("promptHash=");
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-schema"), "utf8")) as HookMarker;
    expect(marker.turnId).toBe("turn-schema");
    expect(marker.cwdHash).toBe(repoHash(cwd));
    expect(marker.taskType).toBe("router-preflight");
    expect(marker.requiresSourceMatrix).toBe(false);
    expect(marker.runId).toBe("run-turn-schema");
    expect(marker.maxBlocks).toBe(2);
  });

  it("does not let a stale research_report satisfy the current marker", () => {
    const cwd = tempRepo();
    const prompt = "research current AI coding agent hidden validation sandbox evaluation framework";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-stale" }
    });
    writeReport(cwd, marker, prompt, new Date(Date.parse(marker.createdAt) - 1_000).toISOString());

    expect(stopValidationGate({ cwd, turnId: "turn-stale" }).decision).toBe("block");
  });

  it("does not use another turn marker to block the current turn", () => {
    const cwd = tempRepo();
    createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-other" }
    });

    expect(stopValidationGate({ cwd, turnId: "turn-current" }).decision).toBe("allow");
  });

  it("allows expired and completed markers", () => {
    const cwd = tempRepo();
    const expired = createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-expired" },
      ttlMs: -1
    });
    expect(stopValidationGate({ cwd, turnId: expired.turnId }).decision).toBe("allow");

    const completed = createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-completed" }
    });
    updateMarker(completed, { status: "completed" });
    expect(stopValidationGate({ cwd, turnId: completed.turnId }).decision).toBe("allow");
  });

  it("allows after maxBlocks is reached with an explicit failure explanation", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-max-blocks" }
    });
    updateMarker(marker, { blockCount: marker.maxBlocks });

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("allow");
    expect(result.hardflowStatus).toBe("failed_max_blocks_reached");
  });

  it("Stop hook reads marker.runId report instead of stale legacy cwd report", async () => {
    const cwd = tempRepo();
    const prompt = "research current onboarding patterns for product teams";
    const report = await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-runid-stop" }
    });
    for (const bucket of report.required_buckets) {
      addManualSourceToReport(cwd, {
        runId: report.runId,
        bucket,
        title: `${bucket} source`,
        url_or_ref: `https://example.com/${bucket}`,
        claim: `${bucket} reviewed.`,
        finding: `${bucket} finding.`
      });
    }

    const stale = buildResearchReport("research stale task", [], "not_configured", { runId: "stale-run", routerOutput: broadResearchRouterOutput });
    writeFileSync(legacyResearchReportPath(cwd), `${JSON.stringify(stale, null, 2)}\n`);

    expect(stopValidationGate({ cwd, turnId: "turn-runid-stop" }).decision).toBe("allow");
  });

  it("rejects a stale report from an old run for the current marker", () => {
    const cwd = tempRepo();
    const prompt = "research current security architecture";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-stale-run" }
    });
    const stale = buildResearchReport("research stale security architecture", [], "not_configured", {
      runId: "old-run",
      turnId: "old-turn",
      routerOutput: broadResearchRouterOutput,
      generatedAt: new Date(Date.parse(marker.createdAt) + 1_000).toISOString()
    });
    for (const target of [researchRunReportPath(cwd, marker.runId), currentResearchReportPath(cwd)]) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(stale, null, 2)}\n`);
    }

    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("block");
  });

  it("rejects subagent-owned reports as parent Stop gate evidence", () => {
    const cwd = tempRepo();
    const prompt = "research current security architecture";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-subagent-owned" }
    });
    const subagentOwned = buildResearchReport(prompt, [], "not_configured", {
      runId: marker.runId,
      turnId: marker.turnId,
      owner: "subagent",
      parentRunId: marker.runId,
      subagentName: "official_docs_researcher",
      bucket: "official_docs",
      routerOutput: broadResearchRouterOutput,
      generatedAt: new Date(Date.parse(marker.createdAt) + 1_000).toISOString()
    });
    for (const target of [researchRunReportPath(cwd, marker.runId), currentResearchReportPath(cwd)]) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(subagentOwned, null, 2)}\n`);
    }

    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("block");
  });

  it("allows no-HEAD repos with untracked files when there is no marker", () => {
    const cwd = tempRepo();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    writeFileSync(join(cwd, "new-file.ts"), "export const x = 1;\n");

    expect(stopValidationGate({ cwd }).decision).toBe("allow");
  });

  it("allows hardflow maintenance markers without business executor_manifest", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "修复 codex-hardflow Stop hook PATH install-global",
        turnId: "turn-maintenance",
        sessionId: "thread-maintenance"
      },
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    expect(stopValidationGate({ cwd, turnId: "turn-maintenance" }).decision).toBe("allow");
  });
});
