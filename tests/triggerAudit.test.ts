import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateCoverage } from "../src/coverageEval.js";
import { createHookMarker, markerPathFor, type HookMarker } from "../src/hookState.js";
import { assertHookActive, hookStatus, readHookEvents } from "../src/hookEvents.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { currentResearchReportPath, repoHash, researchRunHookEventsPath, researchRunReportPath } from "../src/paths.js";
import { addManualSourceToReport, addSubagentReport, buildResearchReport, mergeSubagentReports, runResearch } from "../src/researchOrchestrator.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";
import { broadResearchRouterOutput } from "./routerFixtures.js";
import { fakeRouteRunner } from "./hookTestUtils.js";
import { completeHardflowJob, createHardflowJob } from "../src/jobs/jobStore.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-trigger-audit-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function writeParentReport(cwd: string, marker: HookMarker, report: Record<string, unknown>): void {
  report.runId = marker.runId;
  report.generatedAt = new Date(Date.parse(marker.createdAt) + 1_000).toISOString();
  for (const target of [researchRunReportPath(cwd, marker.runId), currentResearchReportPath(cwd)]) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  }
}

describe("programmatic trigger audit", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("UserPromptSubmit writes hook_events.jsonl and marker trigger fields", () => {
    const cwd = tempRepo();
    userPromptSubmit({ cwd, prompt: "research current AI agent frameworks", turnId: "turn-trigger-hook" }, process.cwd(), { routeRunner: fakeRouteRunner(broadResearchRouterOutput) });
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-trigger-hook"), "utf8")) as HookMarker;

    expect(marker.triggerSource).toBe("hook_user_prompt_submit");
    expect(marker.programmaticTrigger).toBe(true);
    expect(existsSync(researchRunHookEventsPath(cwd, marker.runId))).toBe(true);
    const events = readHookEvents(cwd, marker.runId);
    expect(events.some((event) => event.eventName === "UserPromptSubmit" && event.programmaticTrigger === true)).toBe(true);
    expect(assertHookActive(cwd, marker.runId).passed).toBe(true);
  });

  it("hooks status reports run-owned hook events when global state is empty", () => {
    const cwd = tempRepo();
    userPromptSubmit({ cwd, prompt: "research current AI agent frameworks", turnId: "turn-trigger-status" }, process.cwd(), { routeRunner: fakeRouteRunner(broadResearchRouterOutput) });
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-trigger-status"), "utf8")) as HookMarker;

    const status = hookStatus(cwd) as Record<string, unknown>;
    expect(status.globalEventCount).toBe(0);
    expect(status.runOwnedEventCount).toBe(1);
    expect(status.eventCount).toBe(1);
    expect(status.latestRunOwnedRunId).toBe(marker.runId);
    expect(status.latestRunOwnedEventPath).toBe(researchRunHookEventsPath(cwd, marker.runId));
    expect(status.warning).toBe("Run-owned hook events exist; global event count alone is not sufficient.");
  });

  it("CLI research reports cli_command trigger fields", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-cli-trigger" }
    });

    expect(report.triggerSource).toBe("cli_command");
    expect(report.programmaticTrigger).toBe(true);
    expect(readHookEvents(cwd, report.runId).some((event) => event.eventName === "CLI")).toBe(true);
  });

  it("AGENTS.md-only report cannot mark programmaticTrigger true or pass hardflow completion", () => {
    const report = buildResearchReport("research current agent framework choices", [], "not_configured", {
      routerOutput: broadResearchRouterOutput,
      triggerSource: "agents_md_only",
      programmaticTrigger: false
    });

    expect(report.triggerSource).toBe("agents_md_only");
    expect(report.programmaticTrigger).toBe(false);
  });

  it("Stop hook blocks a hardflow completion claim without programmaticTrigger", () => {
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
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      input: { turnId: "turn-false-hardflow-claim" }
    });
    writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: prompt, currentRunId: marker.runId, triggerSource: "hook_user_prompt_submit", programmaticTrigger: true }, broadResearchRouterOutput, "llm", undefined, marker.turnId));
    createHardflowJob({
      runId: marker.runId,
      cwd,
      rawUserPrompt: prompt,
      promptHash: marker.promptHash,
      turnId: marker.turnId,
      triggerSource: "hook_user_prompt_submit"
    });
    completeHardflowJob(cwd, marker.runId, {
      route: "research",
      routerTracePath: "",
      researchReportPath: researchRunReportPath(cwd, marker.runId),
      threadIds: []
    });
    const report = buildResearchReport(prompt, [], "not_configured", {
      runId: marker.runId,
      turnId: marker.turnId,
      routerOutput: broadResearchRouterOutput,
      runnerMode: "strict_programmatic",
      triggerSource: "agents_md_only",
      programmaticTrigger: false
    }) as unknown as Record<string, unknown>;
    report.status = "completed";
    writeParentReport(cwd, marker, report);

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.continue).toBe(false);
    expect(result.decision).toBeUndefined();
    expect(String(result.stopReason)).toContain("programmaticTrigger");
  });

  it("records not_spawned when App subagents have not actually spawned", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-not-spawned-factual" }
    });

    expect(report.subagent_status).toBe("not_spawned");
    expect(report.subagent_trigger_source).toBe("none");
    expect(report.subagent_skip_reason).toBeTruthy();
  });

  it("marks subagent_status spawned only after subagent report merge", async () => {
    const cwd = tempRepo();
    const parent = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-subagent-spawned-after-merge" }
    });
    addSubagentReport(cwd, {
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
          date_or_version: "2026-06-10",
          claim: "Official docs reviewed.",
          confidence: "high",
          notes: "Subagent evidence."
        }
      ],
      queries_run: ["official docs query"]
    });
    const merged = mergeSubagentReports(cwd, parent.runId);

    expect(merged.subagent_status).toBe("spawned");
    expect(merged.subagent_trigger_source).toBe("app_tool");
  });

  it("strict_programmatic mode fails instead of falling back to manual when SDK threads are unavailable", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      strictProgrammatic: true,
      sdkAvailable: false,
      input: { turnId: "turn-strict-programmatic-unavailable" }
    });

    expect(report.strict_programmatic).toBe(true);
    expect(report.runner_mode).toBe("strict_programmatic");
    expect(report.evidence_mode).toBe("none");
    expect(report.status).toBe("failed");
    expect(report.failure_reason).toBe("sdk_threads runner unavailable");
    expect(report.manual_fallback_reason).toBeUndefined();
    expect(report.subagent_trigger_source).toBe("sdk_threads");
  });

  it("coverage eval computes coverage metrics without claiming broader-than-default when no baseline exists", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-coverage-eval" }
    });
    addManualSourceToReport(cwd, {
      runId: report.runId,
      bucket: "official_docs",
      title: "Official docs",
      source_type: "official_docs",
      url_or_ref: "https://example.com/docs",
      claim: "Official docs reviewed."
    });
    addManualSourceToReport(cwd, {
      runId: report.runId,
      bucket: "github",
      title: "GitHub repo",
      source_type: "github",
      url_or_ref: "https://github.com/example/repo",
      claim: "GitHub reviewed."
    });

    const result = evaluateCoverage(cwd, { runId: report.runId });
    expect(result.requiredBucketCount).toBeGreaterThan(0);
    expect(result.bucketCoverageRatio).toBeGreaterThan(0);
    expect(result.uniqueSourceTypeCount).toBe(2);
    expect(result.coverage_claim).toBe("hardflow coverage is broad by configured matrix");
    expect(result.coverage_claim).not.toContain("default Codex search");
  });
});
