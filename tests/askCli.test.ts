import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runAsk } from "../src/ask/askRunner.js";
import { loadEvidenceLedger } from "../src/coverage/evidenceLedger.js";
import { createHardflowJob, failHardflowJob, readHardflowJob } from "../src/jobs/jobStore.js";
import { researchRunReportPath } from "../src/paths.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-ask-cli-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function runCli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), [join(process.cwd(), "src", "cli.ts"), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CODEX_HARDFLOW_HOME: process.env.CODEX_HARDFLOW_HOME ?? mkdtempSync(join(tmpdir(), "hardflow-state-")) }
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("codex-hardflow ask CLI", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("ask direct_answer does not run research", async () => {
    const cwd = tempRepo();
    const result = await runAsk({
      cwd,
      rawUserPrompt: "translate hello to Chinese",
      runId: "run-ask-direct",
      routerProvider: "mock",
      workerProvider: "mock",
      directAnswerRunner: async () => "你好"
    });

    expect(result.status).toBe("completed");
    expect(result.route).toBe("direct_answer");
    expect(result.answer).toBe("你好");
    expect(result.coverageSummary).toBeNull();
    expect(existsSync(researchRunReportPath(cwd, result.runId))).toBe(false);
  });

  it("ask research runs strict_programmatic and synthesizes from EvidenceLedger", async () => {
    const cwd = tempRepo();
    const result = await runAsk({
      cwd,
      rawUserPrompt: "What are current practical solutions for agent memory?",
      runId: "run-ask-research",
      routerProvider: "mock",
      workerProvider: "mock",
      maxSourcesPerWorker: 2
    });

    const report = JSON.parse(readFileSync(researchRunReportPath(cwd, result.runId), "utf8")) as {
      runner_mode: string;
      programmaticMultiAgent: boolean;
      app_subagent_status: string;
      subagent_status: string;
    };
    const ledger = loadEvidenceLedger(cwd, result.runId);
    expect(result.status).toBe("completed");
    expect(result.route).toBe("research");
    expect(result.coverageSummary?.requiredBucketCount).toBeGreaterThan(0);
    expect(result.coverageSummary?.evidenceItemCount).toBeGreaterThan(0);
    expect(result.sourceSummary.length).toBeGreaterThan(0);
    expect(result.answer).toContain("The research covered");
    expect(result.answer).not.toContain("Mock evidence for official_docs.");
    expect(ledger.items.length).toBeGreaterThan(0);
    expect(report.runner_mode).toBe("strict_programmatic");
    expect(report.programmaticMultiAgent).toBe(true);
    expect(report.app_subagent_status).toBe("not_applicable");
    expect(report.subagent_status).not.toBe("spawned");
  });

  it("ask --from-run reads a completed run", async () => {
    const cwd = tempRepo();
    const completed = await runAsk({
      cwd,
      rawUserPrompt: "What are current practical solutions for agent memory?",
      runId: "run-ask-from-run-source",
      routerProvider: "mock",
      workerProvider: "mock"
    });
    const fromRun = await runAsk({ cwd, fromRunId: completed.runId });

    expect(fromRun.status).toBe("completed");
    expect(fromRun.route).toBe("research");
    expect(fromRun.answer).toContain("Answer from HardFlow evidence");
    expect(fromRun.answer).not.toContain("Mock evidence for official_docs.");
  });

  it("ask --async creates a job only", async () => {
    const cwd = tempRepo();
    const result = await runAsk({
      cwd,
      rawUserPrompt: "What are current practical solutions for agent memory?",
      runId: "run-ask-async",
      routerProvider: "mock",
      workerProvider: "mock",
      async: true
    });
    const job = readHardflowJob(cwd, result.runId);

    expect(result.async).toBe(true);
    expect(result.status).toBe("pending");
    expect(job?.status).toBe("pending");
    expect(job?.route).toBeNull();
  });

  it("ask --json outputs machine-readable async result", () => {
    const cwd = tempRepo();
    const cli = runCli(cwd, ["ask", "--async", "--json", "--router-provider", "mock", "--worker-provider", "mock", "What are current practical solutions?"]);
    const parsed = JSON.parse(cli.stdout) as { runId: string; status: string; async: boolean; noOrdinaryWebFallback: boolean };

    expect(cli.status).toBe(0);
    expect(parsed.runId).toBeTruthy();
    expect(parsed.status).toBe("pending");
    expect(parsed.async).toBe(true);
    expect(parsed.noOrdinaryWebFallback).toBe(true);
  });

  it("ask --json does not print progress by default", () => {
    const cwd = tempRepo();
    const cli = runCli(cwd, ["ask", "--json", "--router-provider", "mock", "--worker-provider", "mock", "What are current practical solutions?"]);
    const parsed = JSON.parse(cli.stdout) as { status: string; answer: string };

    expect(cli.status).toBe(0);
    expect(parsed.status).toBe("completed");
    expect(cli.stderr).not.toContain("HardFlow researching");
  });

  it("ask failed exits nonzero", () => {
    const cwd = tempRepo();
    createHardflowJob({
      runId: "run-ask-failed",
      cwd,
      rawUserPrompt: "research failed",
      promptHash: "hash",
      turnId: "turn-ask-failed",
      triggerSource: "cli"
    });
    failHardflowJob(cwd, "run-ask-failed", "router failed");
    const cli = runCli(cwd, ["ask", "--from-run", "run-ask-failed", "--json"]);
    const parsed = JSON.parse(cli.stdout) as { status: string; failureReason: string };

    expect(cli.status).not.toBe(0);
    expect(parsed.status).toBe("failed");
    expect(parsed.failureReason).toContain("router failed");
  });
});
