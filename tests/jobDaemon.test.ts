import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { markerPathFor } from "../src/hookState.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { daemonStatus } from "../src/daemon/daemon.js";
import { runHardflowJobOnce, runPendingHardflowJobs } from "../src/daemon/jobRunner.js";
import { claimHardflowJob, completeHardflowJob, createHardflowJob, failHardflowJob, readHardflowJob, updateHardflowJob } from "../src/jobs/jobStore.js";
import { hardflowRunCodexHome, repoHash, researchRunReportPath, researchRunRouterTracePath, researchRunSdkWorkerStatePath } from "../src/paths.js";
import { routerOutputForBuckets } from "./routerFixtures.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-job-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function directOutput() {
  return routerOutputForBuckets([], {
    route: "direct_answer",
    workflowPattern: "direct",
    researchProfile: "none",
    requiresSourceMatrix: false,
    reasons: ["Direct answer."],
    risks: []
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

describe("HardFlow job daemon mode", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
    const sourceCodexHome = mkdtempSync(join(tmpdir(), "hardflow-source-codex-home-"));
    writeFileSync(join(sourceCodexHome, "auth.json"), "{}\n");
    writeFileSync(join(sourceCodexHome, "hooks.json"), "{}\n");
    process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME = sourceCodexHome;
  });

  it("UserPromptSubmit creates a pending job and Stop blocks it", () => {
    const cwd = tempRepo();
    userPromptSubmit({ cwd, prompt: "What are current practical solutions for agent memory?", turnId: "turn-job-pending" }, process.cwd());
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-job-pending"), "utf8")) as { runId: string };
    const job = readHardflowJob(cwd, marker.runId);

    expect(job?.status).toBe("pending");
    expect(job?.routerProvider).toBe("codex_cli");
    expect(job?.workerProvider).toBe("codex_sdk");
    const stop = stopValidationGate({ cwd, turnId: "turn-job-pending" });
    expect(stop.decision).toBe("block");
    expect(stop.hardflowStatus).toBe("hardflow_job_pending");
    expect((stop.progressSnapshot as { queuePosition?: number })?.queuePosition).toBe(1);
  });

  it("Stop pending/running block includes queue and worker progress snapshot", () => {
    const cwd = tempRepo();
    userPromptSubmit({ cwd, prompt: "What are current practical solutions for agent memory?", turnId: "turn-job-progress" }, process.cwd());
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-job-progress"), "utf8")) as { runId: string };
    updateHardflowJob(
      cwd,
      marker.runId,
      {
        status: "researching",
        route: "research",
        researchScope: "external_exhaustive",
        evidenceNeed: "external_sources_required",
        requestedWorkerCount: 2,
        allocatedWorkerCount: 2
      },
      "researching"
    );
    const workerStatePath = researchRunSdkWorkerStatePath(cwd, marker.runId, "official_docs");
    mkdirSync(dirname(workerStatePath), { recursive: true });
    writeFileSync(
      workerStatePath,
      `${JSON.stringify({
        bucket: "official_docs",
        status: "running",
        currentStep: "collect_sources",
        partialEvidenceCount: 1,
        sourcesFoundCount: 1,
        lastHeartbeatAt: "2026-06-17T00:00:00.000Z",
        failureCategory: "",
        retryCount: 0
      })}\n`
    );

    const stop = stopValidationGate({ cwd, turnId: "turn-job-progress" });
    const snapshot = stop.progressSnapshot as {
      runId: string;
      status: string;
      researchScope: string;
      runningBucketCount: number;
      currentWorkers: Array<{ bucket: string; status: string; currentStep: string; partialEvidenceCount: number; sourcesFoundCount: number }>;
    };
    expect(stop.decision).toBe("block");
    expect(snapshot.runId).toBe(marker.runId);
    expect(snapshot.status).toBe("researching");
    expect(snapshot.researchScope).toBe("external_exhaustive");
    expect(snapshot.runningBucketCount).toBe(1);
    expect(snapshot.currentWorkers[0]).toMatchObject({
      bucket: "official_docs",
      status: "running",
      currentStep: "collect_sources",
      partialEvidenceCount: 1,
      sourcesFoundCount: 1
    });
  });

  it("Stop allows a completed direct_answer job without research", () => {
    const cwd = tempRepo();
    userPromptSubmit({ cwd, prompt: "translate hello to Chinese", turnId: "turn-job-direct" }, process.cwd());
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-job-direct"), "utf8")) as { runId: string };
    completeHardflowJob(cwd, marker.runId, { route: "direct_answer", routerTracePath: researchRunRouterTracePath(cwd, marker.runId), threadIds: [] });

    const stop = stopValidationGate({ cwd, turnId: "turn-job-direct" });
    expect(stop.decision).toBe("allow");
    expect(String(stop.notice)).toContain("direct_answer");
  });

  it("Stop blocks failed jobs", () => {
    const cwd = tempRepo();
    userPromptSubmit({ cwd, prompt: "What are current practical solutions for agent memory?", turnId: "turn-job-failed" }, process.cwd());
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-job-failed"), "utf8")) as { runId: string };
    failHardflowJob(cwd, marker.runId, "router failed");

    const stop = stopValidationGate({ cwd, turnId: "turn-job-failed" });
    expect(stop.decision).toBe("block");
    expect(stop.hardflowStatus).toBe("hardflow_job_failed");
    expect(String(stop.reason)).toContain("router failed");
  });

  it("jobs run-once completes a direct_answer job with mock router", async () => {
    const cwd = tempRepo();
    const job = createHardflowJob({
      runId: "run-direct-once",
      cwd,
      rawUserPrompt: "translate hello",
      promptHash: "hash",
      turnId: "turn-direct-once",
      triggerSource: "cli",
      routerProvider: "mock"
    });

    const completed = await runHardflowJobOnce(cwd, job.runId, { mockRouterOutput: directOutput() });
    expect(completed.status).toBe("completed");
    expect(completed.route).toBe("direct_answer");
    expect(existsSync(researchRunRouterTracePath(cwd, job.runId))).toBe(true);
    expect(existsSync(hardflowRunCodexHome(cwd, job.runId))).toBe(true);
    expect(existsSync(join(hardflowRunCodexHome(cwd, job.runId), "auth.json"))).toBe(true);
    expect(existsSync(join(hardflowRunCodexHome(cwd, job.runId), "hooks.json"))).toBe(false);
  });

  it("jobs run-once runs strict research for research route with mock SDK worker", async () => {
    const cwd = tempRepo();
    const job = createHardflowJob({
      runId: "run-research-once",
      cwd,
      rawUserPrompt: "What are current practical solutions for agent memory?",
      promptHash: "hash",
      turnId: "turn-research-once",
      triggerSource: "hook_user_prompt_submit",
      routerProvider: "mock"
    });

    const completed = await runHardflowJobOnce(cwd, job.runId, {
      mockRouterOutput: routerOutputForBuckets(["official_docs", "github", "codex_default_discovery"]),
      sdkAvailable: true,
      sdkStepRunner: async ({ step, bucket, onThreadId }) => {
        onThreadId(`thread-${bucket}`);
        expect(process.env.CODEX_HOME).toBe(hardflowRunCodexHome(cwd, job.runId));
        expect(process.env.CODEX_HARDFLOW_INTERNAL).toBe("1");
        if (step === "partial_evidence" || step === "final_report") return sourceRunnerJson(bucket);
        return JSON.stringify({ bucket, queries_run: [`${bucket} query`], sources_found: [], searched_but_no_signal: false });
      }
    });

    expect(completed.status).toBe("completed");
    expect(completed.route).toBe("research");
    expect(completed.threadIds?.length).toBeGreaterThan(0);
    expect(existsSync(researchRunReportPath(cwd, job.runId))).toBe(true);
    expect(existsSync(join(hardflowRunCodexHome(cwd, job.runId), "auth.json"))).toBe(true);
    expect(existsSync(join(hardflowRunCodexHome(cwd, job.runId), "hooks.json"))).toBe(false);
  });

  it("claims a pending job with a lock", () => {
    const cwd = tempRepo();
    const job = createHardflowJob({
      runId: "run-lock",
      cwd,
      rawUserPrompt: "prompt",
      promptHash: "hash",
      turnId: "turn-lock",
      triggerSource: "cli"
    });
    const first = claimHardflowJob(cwd, job.runId, "owner-a");
    const second = claimHardflowJob(cwd, job.runId, "owner-b");

    expect(first?.job.runId).toBe(job.runId);
    expect(second).toBeNull();
    first?.release();
  });

  it("keeps jobs pending when maxGlobalSdkWorkers budget is exhausted", async () => {
    const cwd = tempRepo();
    const first = createHardflowJob({
      runId: "run-worker-budget-a",
      cwd,
      rawUserPrompt: "prompt a",
      promptHash: "hash-a",
      turnId: "turn-worker-budget-a",
      triggerSource: "cli",
      routerProvider: "mock",
      requestedWorkerCount: 2
    });
    const second = createHardflowJob({
      runId: "run-worker-budget-b",
      cwd,
      rawUserPrompt: "prompt b",
      promptHash: "hash-b",
      turnId: "turn-worker-budget-b",
      triggerSource: "cli",
      routerProvider: "mock",
      requestedWorkerCount: 2
    });

    const results = await runPendingHardflowJobs(cwd, {
      daemonConfig: {
        maxGlobalSdkWorkers: 1,
        maxConcurrentJobs: 4,
        maxConcurrentForegroundJobs: 4,
        maxConcurrentBackgroundJobs: 2
      }
    });

    expect(results).toEqual([]);
    expect(readHardflowJob(cwd, first.runId)?.status).toBe("pending");
    expect(readHardflowJob(cwd, second.runId)?.status).toBe("pending");
    const status = daemonStatus(cwd, { maxGlobalSdkWorkers: 1 });
    expect(status.pendingJobs).toBe(2);
    expect(status.queuedJobs).toBe(2);
    expect(status.nextJobs[0]?.queuePosition).toBe(1);
  });

  it("orders high priority jobs before low priority jobs in daemon status", () => {
    const cwd = tempRepo();
    createHardflowJob({
      runId: "run-low-priority",
      cwd,
      rawUserPrompt: "low",
      promptHash: "low",
      turnId: "turn-low-priority",
      triggerSource: "cli",
      priority: "low",
      foreground: false,
      currentUserTurn: false
    });
    createHardflowJob({
      runId: "run-high-priority",
      cwd,
      rawUserPrompt: "high",
      promptHash: "high",
      turnId: "turn-high-priority",
      triggerSource: "hook_user_prompt_submit",
      priority: "high",
      foreground: true,
      currentUserTurn: true
    });

    const status = daemonStatus(cwd);
    expect(status.nextJobs[0]?.runId).toBe("run-high-priority");
    expect(readHardflowJob(cwd, "run-high-priority")?.queuePosition).toBe(1);
    expect(readHardflowJob(cwd, "run-low-priority")?.queuePosition).toBe(2);
  });
});
