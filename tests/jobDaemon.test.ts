import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { markerPathFor } from "../src/hookState.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { runHardflowJobOnce } from "../src/daemon/jobRunner.js";
import { claimHardflowJob, completeHardflowJob, createHardflowJob, failHardflowJob, readHardflowJob } from "../src/jobs/jobStore.js";
import { hardflowRunCodexHome, repoHash, researchRunReportPath, researchRunRouterTracePath } from "../src/paths.js";
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
});
