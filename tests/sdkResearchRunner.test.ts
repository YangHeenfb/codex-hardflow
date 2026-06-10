import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCoveragePlan, type CoveragePlan } from "../src/coverage/coveragePlan.js";
import { listEvidence } from "../src/coverage/evidenceLedger.js";
import { evaluateCoverage } from "../src/coverageEval.js";
import {
  researchRunSdkWorkerCheckpointsDir,
  researchRunSdkWorkerFinalReportPath,
  researchRunSdkWorkerPartialEvidencePath,
  researchRunSdkWorkerStatePath
} from "../src/paths.js";
import { listResearchWorkers, resumeResearchRun, runResearch } from "../src/researchOrchestrator.js";
import { runSdkResearchPool, type SdkResearchStepRunner, type SdkResearchPoolOptions } from "../src/research/sdkResearchRunner.js";
import type { ResearchSource, SdkWorkerState, SourceCoverageMatrix } from "../src/schemas.js";
import { broadResearchRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";

function tempRepo(prefix = "hardflow-sdk-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function source(bucket: string, index = 1): ResearchSource {
  return {
    bucket,
    title: `${bucket} source ${index}`,
    source_type: bucket,
    url_or_ref: `https://example.com/${bucket}/${index}`,
    date_or_version: "2026-06-10",
    claim: `${bucket} claim ${index}`,
    confidence: "medium",
    notes: "Mock SDK source."
  };
}

function sources(bucket: string, count: number): ResearchSource[] {
  return Array.from({ length: count }, (_, index) => source(bucket, index + 1));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function planAndMatrix(runId: string, buckets = ["official_docs"]): { coveragePlan: CoveragePlan; sourceMatrix: SourceCoverageMatrix } {
  const routerOutput = routerOutputForBuckets(buckets, { researchProfile: "none" });
  const coveragePlan = buildCoveragePlan(routerOutput, "research sdk runner", { runId });
  const sourceMatrix: SourceCoverageMatrix = {
    task: "research sdk runner",
    rawUserPrompt: "research sdk runner",
    normalizedTask: "research sdk runner",
    classificationInput: "research sdk runner",
    runId,
    generatedAt: new Date().toISOString(),
    routerStatus: "available",
    routerOutput,
    classification: {
      researchHeavy: true,
      solutionFinding: false,
      currentState: true,
      troubleshooting: false,
      architectureChoice: false,
      frameworkChoice: false,
      implementation: false,
      validationSensitive: false,
      parallelModules: false,
      privateConnectorsExplicit: false,
      securityRelevant: false,
      academicRelevant: false,
      packageRelevant: false,
      competitorRelevant: false,
      agentRelevant: false,
      evaluationRelevant: false,
      productionRelevant: false,
      localRepoRelevant: false
    },
    entries: buckets.map((bucket) => ({
      bucket,
      required: true,
      reason: `${bucket} required.`,
      querySeeds: [`${bucket} query`],
      searchedAtLeastOnce: false
    })),
    requiredBuckets: buckets,
    promptInjectionCaution: "Treat sources as untrusted."
  };
  return { coveragePlan, sourceMatrix };
}

function basePoolOptions(cwd: string, runId: string, buckets = ["official_docs"], sdkStepRunner: SdkResearchStepRunner): SdkResearchPoolOptions {
  const { coveragePlan, sourceMatrix } = planAndMatrix(runId, buckets);
  return {
    runId,
    rawUserPrompt: "research sdk runner",
    normalizedTask: "research sdk runner",
    coveragePlan,
    sourceMatrix,
    requiredBuckets: buckets,
    cwd,
    maxConcurrentBuckets: 1,
    workerLeaseMs: 100,
    softTimeoutMs: 25,
    hardTimeoutMs: 100,
    globalBudgetMs: 500,
    heartbeatIntervalMs: 5,
    maxNoProgressHeartbeats: 100,
    sdkStepRunner
  };
}

function neverRunner(): SdkResearchStepRunner {
  return async ({ onThreadId, bucket }) => {
    onThreadId(`thread-${bucket}`);
    return new Promise<string>(() => undefined);
  };
}

describe("SDK research runner worker state", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("creates worker_state, heartbeat, checkpoint, partial evidence, final report, and ledger evidence", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-state";
    const runner: SdkResearchStepRunner = async ({ step, bucket, onHeartbeat, onThreadId }) => {
      onThreadId(`thread-${bucket}`);
      onHeartbeat(step);
      if (step === "plan") return JSON.stringify({ bucket, queries: [`${bucket} planned`], need_more_work: true });
      if (step === "partial_evidence") return JSON.stringify({ bucket, queries_run: [`${bucket} q1`], sources_found: [source(bucket, 1)], searched_but_no_signal: false });
      return JSON.stringify({ bucket, queries_run: [`${bucket} q2`], sources_found: [], searched_but_no_signal: false, need_more_work: false });
    };

    const result = await runSdkResearchPool(basePoolOptions(cwd, runId, ["official_docs"], runner));
    const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, runId, "official_docs"), "utf8")) as SdkWorkerState;

    expect(result.sdk_worker_status).toBe("completed");
    expect(state.status).toBe("completed");
    expect(state.threadId).toBe("thread-official_docs");
    expect(Date.parse(state.lastHeartbeatAt)).toBeGreaterThanOrEqual(Date.parse(state.startedAt));
    expect(Date.parse(state.lastCheckpointAt)).toBeGreaterThanOrEqual(Date.parse(state.startedAt));
    expect(state.partialEvidenceCount).toBe(1);
    expect(existsSync(researchRunSdkWorkerPartialEvidencePath(cwd, runId, "official_docs"))).toBe(true);
    expect(readdirSync(researchRunSdkWorkerCheckpointsDir(cwd, runId, "official_docs")).length).toBeGreaterThanOrEqual(3);
    expect(existsSync(researchRunSdkWorkerFinalReportPath(cwd, runId, "official_docs"))).toBe(true);
    expect(listEvidence(cwd, runId).map((item) => item.engine)).toContain("sdk_official_docs");
  });

  it("soft timeout does not fail a worker that has heartbeat and progress", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-soft-timeout-progress";
    const runner: SdkResearchStepRunner = async ({ step, bucket, onHeartbeat, onThreadId }) => {
      onThreadId(`thread-${bucket}`);
      onHeartbeat(step);
      if (step === "plan") return JSON.stringify({ bucket, queries: [`${bucket} planned`], need_more_work: true });
      if (step === "partial_evidence") {
        await delay(35);
        onHeartbeat(step);
        return JSON.stringify({ bucket, queries_run: [`${bucket} q1`], sources_found: [source(bucket, 1)], searched_but_no_signal: false });
      }
      return JSON.stringify({ bucket, queries_run: [`${bucket} q2`], sources_found: [], searched_but_no_signal: false, need_more_work: false });
    };

    const result = await runSdkResearchPool({
      ...basePoolOptions(cwd, runId, ["official_docs"], runner),
      workerLeaseMs: 100,
      softTimeoutMs: 10,
      hardTimeoutMs: 200,
      heartbeatIntervalMs: 5,
      maxNoProgressHeartbeats: 100
    });
    const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, runId, "official_docs"), "utf8")) as SdkWorkerState;

    expect(result.sdk_worker_status).toBe("completed");
    expect(state.status).toBe("completed");
    expect(state.partialEvidenceCount).toBe(1);
  });

  it("limits recorded worker sources to maxSourcesPerWorker", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-source-limit";
    const prompts: string[] = [];
    const result = await runSdkResearchPool({
      ...basePoolOptions(cwd, runId, ["official_docs"], async ({ step, bucket, prompt, onThreadId }) => {
        onThreadId(`thread-${bucket}`);
        prompts.push(prompt);
        if (step === "plan") return JSON.stringify({ bucket, queries: ["q"], need_more_work: true });
        return JSON.stringify({ bucket, queries_run: ["q"], sources_found: sources(bucket, 3), searched_but_no_signal: false, need_more_work: false });
      }),
      maxSourcesPerWorker: 2
    });
    const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, runId, "official_docs"), "utf8")) as SdkWorkerState;

    expect(result.researcherReports[0]?.sources_found).toHaveLength(2);
    expect(state.partialEvidenceCount).toBe(2);
    expect(prompts.join("\n")).toContain("Maximum sources for this bucket: 2");
  });

  it("hard timeout marks a worker needs_resume", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-hard-timeout";
    const result = await runSdkResearchPool({
      ...basePoolOptions(cwd, runId, ["official_docs"], neverRunner()),
      hardTimeoutMs: 20,
      heartbeatIntervalMs: 5,
      maxNoProgressHeartbeats: 100
    });
    const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, runId, "official_docs"), "utf8")) as SdkWorkerState;

    expect(state.status).toBe("needs_resume");
    expect(state.failureReason).toContain("hard timeout");
    expect(result.partialBuckets).toContain("official_docs");
  });

  it("hard timeout keeps partial evidence and final report for resume", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-hard-timeout-partial";
    const result = await runSdkResearchPool({
      ...basePoolOptions(cwd, runId, ["official_docs"], async ({ step, bucket, onThreadId }) => {
        onThreadId(`thread-${bucket}`);
        if (step === "partial_evidence") return JSON.stringify({ bucket, queries_run: ["q"], sources_found: [source(bucket)], searched_but_no_signal: false });
        if (step === "final_report") return new Promise<string>(() => undefined);
        return JSON.stringify({ bucket, queries_run: ["q"], sources_found: [], searched_but_no_signal: false });
      }),
      workerLeaseMs: 100,
      hardTimeoutMs: 30,
      heartbeatIntervalMs: 5,
      maxNoProgressHeartbeats: 100
    });
    const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, runId, "official_docs"), "utf8")) as SdkWorkerState;

    expect(state.status).toBe("needs_resume");
    expect(state.partialEvidenceCount).toBe(1);
    expect(result.partialBuckets).toContain("official_docs");
    expect(readFileSync(researchRunSdkWorkerPartialEvidencePath(cwd, runId, "official_docs"), "utf8")).toContain("official_docs source 1");
    expect(existsSync(researchRunSdkWorkerFinalReportPath(cwd, runId, "official_docs"))).toBe(true);
  });

  it("lease expiration without worker heartbeat marks a worker failed as stalled", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-lease";
    const result = await runSdkResearchPool({
      ...basePoolOptions(cwd, runId, ["official_docs"], neverRunner()),
      workerLeaseMs: 5,
      heartbeatIntervalMs: 10,
      hardTimeoutMs: 100,
      maxNoProgressHeartbeats: 100
    });
    const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, runId, "official_docs"), "utf8")) as SdkWorkerState;

    expect(state.status).toBe("failed");
    expect(state.failureReason).toContain("stalled");
    expect(result.failedBuckets).toContain("official_docs");
  });

  it("no-progress heartbeats stop a worker as needs_resume", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-no-progress";
    const result = await runSdkResearchPool({
      ...basePoolOptions(cwd, runId, ["official_docs"], neverRunner()),
      workerLeaseMs: 100,
      heartbeatIntervalMs: 5,
      hardTimeoutMs: 100,
      maxNoProgressHeartbeats: 1
    });
    const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, runId, "official_docs"), "utf8")) as SdkWorkerState;

    expect(state.status).toBe("needs_resume");
    expect(state.failureReason).toContain("no progress");
    expect(result.partialBuckets).toContain("official_docs");
  });
});

describe("SDK research runner integration", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("strict_programmatic mock SDK runner records three buckets, worker artifacts, report evidence, and coverage eval evidence", async () => {
    const cwd = tempRepo();
    const buckets = ["local_repo", "official_docs", "github"];
    const report = await runResearch("strict research sdk runner", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: routerOutputForBuckets(buckets, { researchProfile: "none" }),
      strictProgrammatic: true,
      sdkAvailable: true,
      input: { turnId: "turn-sdk-strict" },
      sdkStepRunner: async ({ step, bucket, onThreadId }) => {
        onThreadId(`thread-${bucket}`);
        if (step === "partial_evidence") return JSON.stringify({ bucket, queries_run: [`${bucket} q`], sources_found: [source(bucket)], searched_but_no_signal: false });
        return JSON.stringify({ bucket, queries_run: [`${bucket} q`], sources_found: [], searched_but_no_signal: false, need_more_work: false });
      }
    });

    expect(report.runner_mode).toBe("strict_programmatic");
    expect(report.evidence_mode).toBe("sdk_threads");
    expect(report.programmaticMultiAgent).toBe(true);
    expect(report.sdk_worker_runs?.map((worker) => worker.bucket).sort()).toEqual([...buckets].sort());
    expect(report.searched_sources_table.map((item) => item.bucket)).toEqual(expect.arrayContaining(buckets));
    expect(report.subagent_status).toBe("not_applicable");
    expect(report.app_subagent_status).toBe("not_applicable");
    expect(listEvidence(cwd, report.runId).map((item) => item.engine)).toEqual(expect.arrayContaining(["sdk_local_repo", "sdk_official_docs", "sdk_github"]));
    for (const bucket of buckets) {
      const state = JSON.parse(readFileSync(researchRunSdkWorkerStatePath(cwd, report.runId, bucket), "utf8")) as SdkWorkerState;
      expect(state.status).toBe("completed");
      expect(state.partialEvidenceCount).toBe(1);
      expect(readdirSync(researchRunSdkWorkerCheckpointsDir(cwd, report.runId, bucket)).length).toBeGreaterThanOrEqual(3);
      expect(readFileSync(researchRunSdkWorkerPartialEvidencePath(cwd, report.runId, bucket), "utf8")).toContain(`${bucket} source 1`);
      expect(existsSync(researchRunSdkWorkerFinalReportPath(cwd, report.runId, bucket))).toBe(true);
    }
    const coverage = evaluateCoverage(cwd, { runId: report.runId });
    expect(coverage.programmaticMultiAgent).toBe(true);
    expect(coverage.evidenceGatePassed).toBe(true);
    expect(coverage.completedBucketCount).toBe(3);
    expect(coverage.localRepoSourceCount).toBe(1);
    expect(coverage.githubSourceCount).toBe(1);
    expect(coverage.coverage_score).toBeGreaterThan(0);
  });

  it("all SDK worker timeouts fail strict_programmatic", async () => {
    const cwd = tempRepo();
    const report = await runResearch("strict research sdk timeout", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: routerOutputForBuckets(["official_docs"], { researchProfile: "none" }),
      strictProgrammatic: true,
      sdkAvailable: true,
      input: { turnId: "turn-sdk-timeout" },
      hardTimeoutMs: 20,
      heartbeatIntervalMs: 5,
      maxNoProgressHeartbeats: 100,
      sdkStepRunner: neverRunner()
    });

    expect(report.status).toBe("failed");
    expect(report.sdk_worker_status).toBe("failed");
    expect(report.programmaticMultiAgent).toBe(true);
    expect(report.manual_fallback_reason).toBeUndefined();
    expect(report.app_handoff_required).toBe(false);
  });

  it("critical completed plus non-critical needs_resume degrades the SDK pool", async () => {
    const cwd = tempRepo();
    const runId = "run-sdk-critical-optional";
    const { coveragePlan, sourceMatrix } = planAndMatrix(runId, ["official_docs", "community"]);
    coveragePlan.sourceBuckets = [
      { bucket: "official_docs", required: true, priority: "critical", reason: "critical docs", expectedEngines: [] },
      { bucket: "community", required: false, priority: "optional", reason: "optional community", expectedEngines: [] }
    ];
    const result = await runSdkResearchPool({
      ...basePoolOptions(cwd, runId, ["official_docs", "community"], async ({ step, bucket, onThreadId }) => {
        onThreadId(`thread-${bucket}`);
        if (bucket === "community") return new Promise<string>(() => undefined);
        if (step === "partial_evidence") return JSON.stringify({ bucket, queries_run: [`${bucket} q`], sources_found: [source(bucket)], searched_but_no_signal: false });
        return JSON.stringify({ bucket, queries_run: [`${bucket} q`], sources_found: [], searched_but_no_signal: false });
      }),
      coveragePlan,
      sourceMatrix,
      hardTimeoutMs: 20,
      heartbeatIntervalMs: 5,
      maxNoProgressHeartbeats: 100
    });

    expect(result.sdk_worker_status).toBe("degraded");
    expect(result.completedBuckets).toContain("official_docs");
    expect(result.partialBuckets).toContain("community");
  });

  it("app_handoff remains unchanged and does not start SDK workers", async () => {
    const cwd = tempRepo();
    let calls = 0;
    const report = await runResearch("research app handoff unchanged", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-app-handoff-unchanged" },
      sdkStepRunner: async () => {
        calls += 1;
        return "{}";
      }
    });

    expect(report.runner_mode).toBe("app_handoff");
    expect(report.sdk_threads_started).toBe(false);
    expect(report.programmaticMultiAgent).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("SDK worker resume and CLI controls", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("resume skips completed workers", async () => {
    const cwd = tempRepo();
    const report = await runResearch("strict research resume skip", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: routerOutputForBuckets(["official_docs"], { researchProfile: "none" }),
      strictProgrammatic: true,
      sdkAvailable: true,
      input: { turnId: "turn-resume-skip" },
      sdkStepRunner: async ({ step, bucket, onThreadId }) => {
        onThreadId(`thread-${bucket}`);
        if (step === "partial_evidence") return JSON.stringify({ bucket, queries_run: ["q"], sources_found: [source(bucket)], searched_but_no_signal: false });
        return JSON.stringify({ bucket, queries_run: ["q"], sources_found: [], searched_but_no_signal: false });
      }
    });

    const resumed = await resumeResearchRun(cwd, report.runId, {
      sdkStepRunner: async () => {
        throw new Error("completed worker should not resume");
      }
    });

    expect(resumed.runId).toBe(report.runId);
    expect(resumed.sdk_worker_runs?.[0]?.status).toBe("completed");
  });

  it("resume uses saved threadId for needs_resume workers", async () => {
    const cwd = tempRepo();
    let finalCalls = 0;
    const initial = await runResearch("strict research resume needed", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: routerOutputForBuckets(["official_docs"], { researchProfile: "none" }),
      strictProgrammatic: true,
      sdkAvailable: true,
      input: { turnId: "turn-resume-needed" },
      hardTimeoutMs: 30,
      heartbeatIntervalMs: 5,
      maxNoProgressHeartbeats: 100,
      sdkStepRunner: async ({ step, bucket, onThreadId }) => {
        onThreadId(`saved-thread-${bucket}`);
        if (step === "partial_evidence") return JSON.stringify({ bucket, queries_run: ["q"], sources_found: [source(bucket)], searched_but_no_signal: false });
        if (step === "final_report") return new Promise<string>(() => undefined);
        return JSON.stringify({ bucket, queries_run: ["q"], sources_found: [], searched_but_no_signal: false });
      }
    });

    expect(initial.sdk_worker_runs?.[0]?.status).toBe("needs_resume");

    const resumed = await resumeResearchRun(cwd, initial.runId, {
      sdkStepRunner: async ({ step, bucket, threadId, onThreadId }) => {
        expect(threadId).toBe(`saved-thread-${bucket}`);
        onThreadId(threadId ?? "");
        finalCalls += 1;
        if (step === "partial_evidence") return JSON.stringify({ bucket, queries_run: ["q2"], sources_found: [source(bucket, 2)], searched_but_no_signal: false });
        return JSON.stringify({ bucket, queries_run: ["q2"], sources_found: [], searched_but_no_signal: false });
      }
    });

    expect(finalCalls).toBeGreaterThan(0);
    expect(resumed.sdk_worker_runs?.find((run) => run.bucket === "official_docs")?.status).toBe("completed");
  });

  it("workers command lists statuses and cancel marks a worker cancelled", () => {
    const cwd = tempRepo("hardflow-sdk-cli-");
    const runId = "run-cli-workers";
    const state: SdkWorkerState = {
      runId,
      workerId: `${runId}-official_docs`,
      bucket: "official_docs",
      threadId: "thread-cli",
      status: "needs_resume",
      startedAt: new Date().toISOString(),
      endedAt: null,
      lastHeartbeatAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      partialEvidenceCount: 1,
      lastProgressAt: new Date().toISOString(),
      currentStep: "final_report",
      leaseExpiresAt: new Date(Date.now() + 1000).toISOString(),
      softTimeoutAt: new Date(Date.now() + 1000).toISOString(),
      hardTimeoutAt: new Date(Date.now() + 1000).toISOString(),
      resumeAvailable: true,
      failureReason: "needs resume"
    };
    const statePath = researchRunSdkWorkerStatePath(cwd, runId, "official_docs");
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    expect(listResearchWorkers(cwd, runId)[0]?.status).toBe("needs_resume");

    const cli = (args: string[]) =>
      spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), [join(process.cwd(), "src", "cli.ts"), ...args], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, CODEX_HARDFLOW_HOME: mkdtempSync(join(tmpdir(), "hardflow-state-")) }
      });
    const workers = cli(["research", "workers", "--run-id", runId]);
    expect(workers.status).toBe(0);
    expect(JSON.parse(workers.stdout).workers[0].status).toBe("needs_resume");

    const cancelled = cli(["research", "cancel", "--run-id", runId, "--bucket", "official_docs"]);
    expect(cancelled.status).toBe(0);
    expect(JSON.parse(cancelled.stdout).status).toBe("cancelled");
    expect(JSON.parse(readFileSync(statePath, "utf8")).status).toBe("cancelled");
  });
});
