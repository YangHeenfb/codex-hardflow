import { dirname } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookEvents } from "../src/hookEvents.js";
import { createHookMarker, markerPathFor, updateMarker, type HookMarker } from "../src/hookState.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { addManualSourceToReport, buildResearchReport, runResearch } from "../src/researchOrchestrator.js";
import { currentResearchReportPath, legacyResearchReportPath, repoHash, researchRunEvidenceLedgerPath, researchRunReportPath, researchRunRouterTracePath } from "../src/paths.js";
import { broadResearchRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";
import { completeHardflowJob, createHardflowJob, failHardflowJob, readHardflowJob } from "../src/jobs/jobStore.js";

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

function sourceRunnerJson(bucket: string): string {
  return JSON.stringify({
    bucket,
    queries_run: [`${bucket} query`],
    sources_found: [
      {
        bucket,
        title: `${bucket} source`,
        source_type: bucket,
        url_or_ref: `https://example.com/${bucket}`,
        date_or_version: "2026-06-16",
        claim: `${bucket} evidence reviewed.`,
        confidence: "medium",
        notes: "Mock SDK source."
      }
    ],
    searched_but_no_signal: false,
    uncertainties: [],
    recommended_followups: []
  });
}

function automaticResearchMarker(cwd: string, prompt: string, turnId: string): HookMarker {
  const marker = createHookMarker({
    cwd,
    prompt,
    sourceRoot: process.cwd(),
    taskType: "router-preflight",
    requiresSourceMatrix: false,
    requiresExecutorManifest: false,
    requiresValidation: false,
    triggerSource: "hook_user_prompt_submit",
    programmaticTrigger: true,
    routeStatus: "routed",
    input: { turnId }
  });
  writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: prompt, currentRunId: marker.runId }, broadResearchRouterOutput, "llm", undefined, marker.turnId));
  createJobForMarker(cwd, marker, "completed", "research");
  return marker;
}

function createJobForMarker(cwd: string, marker: HookMarker, status: "pending" | "completed" | "failed", route: "research" | "direct_answer" | "router_failed" = "research"): void {
  if (!readHardflowJob(cwd, marker.runId)) {
    createHardflowJob({
      runId: marker.runId,
      cwd,
      rawUserPrompt: marker.rawUserPrompt ?? "prompt",
      promptHash: marker.promptHash,
      turnId: marker.turnId,
      triggerSource: "hook_user_prompt_submit"
    });
  }
  if (status === "completed") {
    completeHardflowJob(cwd, marker.runId, {
      route,
      routerTracePath: researchRunRouterTracePath(cwd, marker.runId),
      researchReportPath: route === "research" ? researchRunReportPath(cwd, marker.runId) : null,
      evidenceLedgerPath: route === "research" ? researchRunEvidenceLedgerPath(cwd, marker.runId) : null,
      threadIds: []
    });
  }
  if (status === "failed") {
    failHardflowJob(cwd, marker.runId, "router timed out", { route });
  }
}

function directRouterOutput() {
  return routerOutputForBuckets([], {
    route: "direct_answer",
    workflowPattern: "direct",
    researchProfile: "none",
    requiresSourceMatrix: false,
    reasons: ["Direct answer."],
    risks: []
  });
}

describe("hook marker Stop gate", () => {
  function clearInternalEnv(): void {
    delete process.env.CODEX_HARDFLOW_INTERNAL;
    delete process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE;
    delete process.env.CODEX_HARDFLOW_PARENT_RUN_ID;
    delete process.env.CODEX_HARDFLOW_INTERNAL_DEPTH;
  }

  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
    clearInternalEnv();
  });
  afterEach(clearInternalEnv);

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
    expect(marker.routeStatus).toBe("router_required");
    expect(marker.routerBlockCount).toBe(0);
    expect(readHardflowJob(cwd, marker.runId)?.status).toBe("pending");
  });

  it("fails closed when a programmatic marker has no job", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "research current AI coding agent hidden validation sandbox evaluation framework",
      sourceRoot: process.cwd(),
      taskType: "router-preflight",
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      routeStatus: "router_required",
      input: { turnId: "turn-router-required" }
    });

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("hardflow_job_missing");
  });

  it("Stop bypasses internal SDK/router calls without enforcing gates", () => {
    const cwd = tempRepo();
    process.env.CODEX_HARDFLOW_INTERNAL = "1";
    process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE = "sdk_worker";
    process.env.CODEX_HARDFLOW_PARENT_RUN_ID = "run-parent";
    process.env.CODEX_HARDFLOW_INTERNAL_DEPTH = "1";

    const result = stopValidationGate({ cwd, turnId: "turn-internal-stop" });

    expect(result.decision).toBe("allow");
    expect(result.hardflowStatus).toBe("internal_bypass");
    expect(readHookEvents(cwd, "run-parent").some((event) => event.eventName === "StopInternalBypass" && event.internalPurpose === "sdk_worker")).toBe(true);
  });

  it("blocks while a queued job is pending", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "translate hello to Chinese",
      sourceRoot: process.cwd(),
      taskType: "router-preflight",
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      routeStatus: "router_required",
      input: { turnId: "turn-auto-route-direct" }
    });

    createJobForMarker(cwd, marker, "pending");
    const result = stopValidationGate({ cwd, turnId: marker.turnId });

    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("hardflow_job_pending");
  });

  it("does not auto-run route or strict research for pending research jobs", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "What are current practical solutions for agentic long horizon work? 中文回答",
      sourceRoot: process.cwd(),
      taskType: "router-preflight",
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      routeStatus: "router_required",
      input: { turnId: "turn-auto-route-research" }
    });

    createJobForMarker(cwd, marker, "pending");
    const result = stopValidationGate({ cwd, turnId: marker.turnId });

    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("hardflow_job_pending");
  });

  it("blocks failed jobs before ordinary answers", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "What are current practical solutions for agentic long horizon work? 中文回答",
      sourceRoot: process.cwd(),
      taskType: "router-preflight",
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      routeStatus: "router_failed",
      input: { turnId: "turn-router-failed" }
    });
    updateMarker(marker, { routerPreflightFailureReason: "router timed out" });
    createJobForMarker(cwd, marker, "failed", "router_failed");

    const result = stopValidationGate({ cwd, turnId: marker.turnId });

    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("hardflow_job_failed");
    expect(String(result.reason)).toContain("router timed out");
  });

  it("allows direct_answer routes without research report", () => {
    const cwd = tempRepo();
    const prompt = "translate hello to Chinese";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "router-preflight",
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      routeStatus: "routed",
      input: { turnId: "turn-direct-answer" }
    });
    const direct = routerOutputForBuckets([], {
      route: "direct_answer",
      workflowPattern: "direct",
      researchProfile: "none",
      requiresSourceMatrix: false,
      reasons: ["Direct translation."],
      risks: []
    });
    writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: prompt, currentRunId: marker.runId }, direct, "llm", undefined, marker.turnId));
    createJobForMarker(cwd, marker, "completed", "direct_answer");

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("allow");
    expect(String(result.notice)).toContain("direct_answer");
  });

  it("blocks automatic research routes when report is app_handoff instead of strict_programmatic", () => {
    const cwd = tempRepo();
    const prompt = "research current AI coding agent hidden validation approaches";
    const marker = automaticResearchMarker(cwd, prompt, "turn-auto-research-app-handoff");
    const report = buildResearchReport(prompt, [], "not_configured", {
      runId: marker.runId,
      turnId: marker.turnId,
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true
    }) as unknown as Record<string, unknown>;
    writeReport(cwd, marker, prompt);
    writeFileSync(researchRunReportPath(cwd, marker.runId), `${JSON.stringify({ ...report, generatedAt: new Date(Date.parse(marker.createdAt) + 1_000).toISOString() }, null, 2)}\n`);

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("block");
    expect(String(result.reason)).toContain("requires strict_programmatic");
  });

  it("blocks completed research jobs when strict report is still missing", () => {
    const cwd = tempRepo();
    const marker = automaticResearchMarker(cwd, "What are current practical solutions for agentic long horizon work? 中文回答", "turn-auto-research-missing");

    const result = stopValidationGate({ cwd, turnId: marker.turnId });

    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("strict_research_report_missing");
    expect(String(result.reason)).toContain("Stop hook does not run strict research");
  });

  it("blocks ordinary answers when completed research job lacks a valid report", () => {
    const cwd = tempRepo();
    const marker = automaticResearchMarker(cwd, "What are current practical solutions for agentic long horizon work? 中文回答", "turn-auto-research-auto-failed");

    const result = stopValidationGate({ cwd, turnId: marker.turnId });

    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("strict_research_report_missing");
    expect(String(result.reason)).toContain("research_report.json is missing");
  });

  it("blocks strict-looking research reports without sdk workers", async () => {
    const cwd = tempRepo();
    const prompt = "What are current practical solutions for agentic long horizon work? 中文回答";
    const marker = automaticResearchMarker(cwd, prompt, "turn-auto-research-ordinary-web");
    const report = await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      runId: marker.runId,
      routerOutput: broadResearchRouterOutput,
      coverageMode: "exhaustive",
      parallelPolicy: "all_required",
      strictProgrammatic: true,
      sdkAvailable: true,
      input: { turnId: "turn-auto-research-ordinary-web-linked" },
      sdkPromptRunner: async (_prompt, _cwd, bucket) => validRunnerJson(bucket)
    });
    report.programmaticMultiAgent = false;
    report.sdk_worker_runs = [];
    for (const target of [researchRunReportPath(cwd, marker.runId), currentResearchReportPath(cwd)]) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    }

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("block");
    expect(String(result.reason)).toContain("programmaticMultiAgent=true");
  });

  it("blocks strict research reports without EvidenceLedger", async () => {
    const cwd = tempRepo();
    const prompt = "What are current practical solutions for agentic long horizon work? 中文回答";
    const marker = automaticResearchMarker(cwd, prompt, "turn-auto-research-no-ledger");
    await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      runId: marker.runId,
      routerOutput: broadResearchRouterOutput,
      coverageMode: "exhaustive",
      parallelPolicy: "all_required",
      strictProgrammatic: true,
      sdkAvailable: true,
      input: { turnId: "turn-auto-research-no-ledger-linked" },
      sdkPromptRunner: async (_prompt, _cwd, bucket) => validRunnerJson(bucket)
    });
    writeFileSync(researchRunEvidenceLedgerPath(cwd, marker.runId), `${JSON.stringify({ runId: marker.runId, updatedAt: new Date().toISOString(), items: [] }, null, 2)}\n`);

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("block");
    expect(String(result.reason)).toContain("non-empty EvidenceLedger");
  });

  it("blocks strict failed reports instead of allowing normal answer", () => {
    const cwd = tempRepo();
    const prompt = "research current hidden validation solutions";
    const marker = automaticResearchMarker(cwd, prompt, "turn-auto-research-failed");
    const report = buildResearchReport(prompt, [], "failed", {
      runId: marker.runId,
      turnId: marker.turnId,
      routerOutput: broadResearchRouterOutput,
      runnerMode: "strict_programmatic",
      strictProgrammatic: true,
      coverageMode: "exhaustive",
      parallelPolicy: "all_required",
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      failureReason: "sdk_threads runner unavailable"
    }) as unknown as Record<string, unknown>;
    report.status = "failed";
    report.generatedAt = new Date(Date.parse(marker.createdAt) + 1_000).toISOString();
    for (const target of [researchRunReportPath(cwd, marker.runId), currentResearchReportPath(cwd)]) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    }

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("strict_research_failed");
    expect(String(result.reason)).toContain("sdk_threads runner unavailable");
  });

  it("allows completed automatic strict exhaustive SDK research with EvidenceLedger", async () => {
    const cwd = tempRepo();
    const prompt = "What are current practical solutions for agentic long horizon work? 中文回答";
    const marker = automaticResearchMarker(cwd, prompt, "turn-auto-research-completed");
    const report = await runResearch(prompt, cwd, {
      sourceRoot: process.cwd(),
      runId: marker.runId,
      routerOutput: broadResearchRouterOutput,
      strictProgrammatic: true,
      coverageMode: "exhaustive",
      parallelPolicy: "all_required",
      sdkAvailable: true,
      input: { turnId: "turn-auto-research-completed-linked" },
      sdkPromptRunner: async (_prompt, _cwd, bucket) => sourceRunnerJson(bucket)
    });

    expect(report.runner_mode).toBe("strict_programmatic");
    expect(report.sdk_worker_runs?.length).toBeGreaterThan(0);
    expect(stopValidationGate({ cwd, turnId: marker.turnId }).decision).toBe("allow");
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

  it("does not allow missing router_trace after maxBlocks is reached", () => {
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
    createJobForMarker(cwd, marker, "completed", "research");

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("block");
    expect(result.hardflowStatus).toBe("router_trace_missing_fail_closed");
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
    writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: prompt, currentRunId: marker.runId }, broadResearchRouterOutput, "llm", undefined, marker.turnId));
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
    writeRouterTrace(cwd, buildRouterTrace({ rawUserPrompt: prompt, currentRunId: marker.runId }, broadResearchRouterOutput, "llm", undefined, marker.turnId));
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

  it("allows explicit hardflow maintenance markers without business executor_manifest", () => {
    const cwd = tempRepo();
    createHookMarker({
      cwd,
      prompt: "修复 codex-hardflow Stop hook PATH install-global",
      sourceRoot: process.cwd(),
      taskType: "hardflow-maintenance",
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-maintenance" }
    });

    expect(stopValidationGate({ cwd, turnId: "turn-maintenance" }).decision).toBe("allow");
  });
});
