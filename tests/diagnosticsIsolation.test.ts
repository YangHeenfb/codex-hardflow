import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendDiagnosticRunResult,
  assertDiagnosticsPlan,
  buildDiagnosticsPlan,
  detectThreadContamination,
  outputOutsideIsolatedRepo,
  runDiagnostics,
  summarizeConcurrency,
  summarizeBucketDifficulty,
  summarizePromptWidth,
  summarizeTimeoutSweep,
  type RunMetric
} from "../src/diagnostics/sdkDiagnostics.js";
import { assertIsolatedWorkspace, copyRepoSnapshot, createDiagnosticExperiment, createIsolatedRunWorkspace, type SnapshotMetadata } from "../src/diagnostics/isolation.js";

const H = "hidden";
const P = "private";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-diagnostics-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function write(path: string, value = "x"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function makeSourceRepo(): string {
  const cwd = tempRepo();
  write(join(cwd, "src", "index.ts"), "export const value = 1;\n");
  write(join(cwd, "package.json"), "{\"name\":\"fixture\"}\n");
  write(join(cwd, "README.md"), "fixture\n");
  write(join(cwd, ".agent", "reports", "current", "research_report.json"), "{}\n");
  write(join(cwd, ".git", "HEAD"), "ref: refs/heads/main\n");
  write(join(cwd, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  write(join(cwd, "dist", "index.js"), "built\n");
  write(join(cwd, "coverage", "coverage.json"), "{}\n");
  write(join(cwd, "tmp", "scratch.txt"), "scratch\n");
  write(join(cwd, "AGENTS.md"), "agent instructions\n");
  write(join(cwd, `${H}-tests`, "case.txt"), "secret\n");
  write(join(cwd, `.${H}-tests`, "case.txt"), "secret\n");
  write(join(cwd, `.validator-${P}`, "case.txt"), "secret\n");
  write(join(cwd, `.agent-${P}`, "case.txt"), "secret\n");
  write(join(cwd, `.codex-${P}`, "case.txt"), "secret\n");
  write(join(cwd, `fixture.${P}.json`), "{}\n");
  write(join(cwd, `fixture.${H}.json`), "{}\n");
  write(join(cwd, ".env"), "TOKEN=x\n");
  write(join(cwd, ".env.local"), "TOKEN=x\n");
  write(join(cwd, "diagnostics-output.json"), "{}\n");
  return cwd;
}

function runMetric(overrides: Partial<RunMetric> = {}): RunMetric {
  return {
    runId: overrides.runId ?? "run-1",
    concurrencyLevel: overrides.concurrencyLevel ?? 1,
    repeatIndex: overrides.repeatIndex ?? 1,
    startedAt: "2026-06-10T00:00:00.000Z",
    endedAt: "2026-06-10T00:00:01.000Z",
    durationMs: overrides.durationMs ?? 1000,
    status: overrides.status ?? "completed",
    coverage_score: overrides.coverage_score ?? 80,
    completedBucketCount: overrides.completedBucketCount ?? 1,
    timeoutBucketCount: overrides.timeoutBucketCount ?? 0,
    failedBucketCount: overrides.failedBucketCount ?? 0,
    invalidJsonCount: overrides.invalidJsonCount ?? 0,
    requiredBucketCount: overrides.requiredBucketCount ?? 1,
    programmaticMultiAgent: overrides.programmaticMultiAgent ?? true,
    sourceCount: overrides.sourceCount ?? 1,
    totalRetryCount: overrides.totalRetryCount ?? 0,
    retriedWorkerCount: overrides.retriedWorkerCount ?? 0,
    retrySuccessRate: overrides.retrySuccessRate ?? 0,
    transientNetworkErrorRate: overrides.transientNetworkErrorRate ?? 0,
    rateLimitRate: overrides.rateLimitRate ?? 0,
    workersFailedAfterRetry: overrides.workersFailedAfterRetry ?? 0,
    workersRecoveredAfterRetry: overrides.workersRecoveredAfterRetry ?? 0,
    noActivityProgressRate: overrides.noActivityProgressRate ?? 0,
    noArtifactProgressRate: overrides.noArtifactProgressRate ?? 0,
    noSemanticProgressRate: overrides.noSemanticProgressRate ?? 0,
    checkpointNudgeSuccessRate: overrides.checkpointNudgeSuccessRate ?? 0,
    workersRecoveredByCheckpointNudge: overrides.workersRecoveredByCheckpointNudge ?? 0,
    workers: overrides.workers ?? [
      {
        bucket: "official_docs",
        status: "completed",
        durationMs: 1000,
        timeToFirstHeartbeatMs: 10,
        timeToFirstEvidenceMs: 100,
        partialEvidenceCount: 1,
        activityEventCount: 1,
        streamEventCount: 0,
        toolActivityCount: 0,
        sourcesFoundCount: 1,
        queriesRunCount: 1,
        noSignalCount: 0,
        heartbeatCount: 1,
        noProgressHeartbeatCount: 0,
        checkpointCount: 1,
        semanticProgressCount: 1,
        checkpointNudgeCount: 0,
        checkpointNudgeSuccessCount: 0,
        checkpointNudgeFailedCount: 0,
        noActivityProgressCount: 0,
        noArtifactProgressCount: 0,
        noSemanticProgressCount: 0,
        progressCategory: "semantic_progress",
        lastProgressReason: "",
        threadIdPresent: true,
        finalReportPresent: true,
        failureReason: "",
        failureCategory: "unknown",
        retryCount: 0,
        maxRetries: 2,
        attemptCount: 1,
        transientNetworkErrorCount: 0,
        rateLimitCount: 0,
        sdkTimeoutCount: 0,
        retrySuccess: false,
        finalAttemptStatus: "completed",
        threadIds: ["thread-1"],
        resumedThreadIds: [],
        replacementThreadIds: [],
        timeLostToBackoffMs: 0,
        firstFailureAt: null,
        lastFailureAt: null,
        threadId: "thread-1",
        variantId: "variant-1",
        runId: overrides.runId ?? "run-1",
        resumedFromThreadId: null
      }
    ]
  };
}

describe("diagnostics isolation harness", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("createIsolatedRunWorkspace creates unique repo and home dirs per variant", () => {
    const cwd = makeSourceRepo();
    const experiment = createDiagnosticExperiment({ cwd, workdirRoot: join(tmpdir(), "diag-workdirs") });
    const a = createIsolatedRunWorkspace({ experiment, variantId: "variant-a", runId: "run-a" });
    const b = createIsolatedRunWorkspace({ experiment, variantId: "variant-b", runId: "run-b" });

    expect(a.isolatedRepoDir).not.toBe(b.isolatedRepoDir);
    expect(a.isolatedHomeDir).not.toBe(b.isolatedHomeDir);
    expect(a.env.CODEX_HARDFLOW_HOME).toBe(a.isolatedHomeDir);
    expect(assertIsolatedWorkspace({ workspace: a }).passed).toBe(true);
  });

  it("copyRepoSnapshot excludes repo state, diagnostics outputs, and private files", () => {
    const cwd = makeSourceRepo();
    const isolatedRepoDir = join(tmpdir(), `diag-snapshot-${Date.now()}`);
    const outputPath = join(cwd, "diagnostics-output.json");
    const metadata = copyRepoSnapshot({
      sourceRepoRoot: cwd,
      isolatedRepoDir,
      experimentId: "exp-1",
      variantId: "variant-1",
      runId: "run-1",
      outputParentPath: outputPath,
      excludeDist: true
    });

    expect(existsSync(join(isolatedRepoDir, "src", "index.ts"))).toBe(true);
    for (const forbidden of [
      ".agent",
      ".git",
      "node_modules",
      "dist",
      "coverage",
      "tmp",
      "AGENTS.md",
      `${H}-tests`,
      `.${H}-tests`,
      `.validator-${P}`,
      `.agent-${P}`,
      `.codex-${P}`,
      `fixture.${P}.json`,
      `fixture.${H}.json`,
      ".env",
      ".env.local",
      "diagnostics-output.json"
    ]) {
      expect(existsSync(join(isolatedRepoDir, forbidden))).toBe(false);
    }
    const written = JSON.parse(readFileSync(join(isolatedRepoDir, ".agent-diagnostics-snapshot.json"), "utf8")) as SnapshotMetadata;
    expect(written.snapshotHash).toBeTruthy();
    expect(written.includedFileCount).toBeGreaterThan(0);
    expect(metadata.excludedPaths.length).toBeGreaterThan(0);
  });

  it("diagnostics dry-run plan uses explicit runIds and disables latest/current selection", async () => {
    const cwd = makeSourceRepo();
    const result = await runDiagnostics({
      command: "sdk-concurrency",
      cwd,
      output: join(cwd, ".agent", "reports", "diagnostics", "dry-run-summary.json"),
      workdirRoot: join(tmpdir(), "diag-dry-run"),
      concurrencyLevels: [1, 3],
      repeats: 2,
      randomize: false
    });
    const plan = JSON.parse(readFileSync(result.planPath, "utf8")) as ReturnType<typeof buildDiagnosticsPlan>;

    expect(result.dryRun).toBe(true);
    expect(result.runCount).toBe(0);
    expect(plan.variants).toHaveLength(4);
    expect(plan.variants.every((variant) => variant.explicitRunIdArgs.includes("--run-id"))).toBe(true);
    expect(plan.variants.every((variant) => variant.coverageEvalArgs.includes("--run-id"))).toBe(true);
    expect(plan.variants.every((variant) => !variant.coverageEvalArgs.includes("--latest-evidence-run"))).toBe(true);
    expect(outputOutsideIsolatedRepo(plan)).toBe(true);
    expect(new Set(plan.variants.map((variant) => variant.runId)).size).toBe(plan.variants.length);
    expect(plan.variants[0].concurrencyLevel).toBe(1);
    expect(plan.variants[2].concurrencyLevel).toBe(3);
  });

  it("diagnostics plan rejects latest/current selection attempts", () => {
    const cwd = makeSourceRepo();
    const plan = buildDiagnosticsPlan({ command: "sdk-concurrency", cwd, concurrencyLevels: [1], repeats: 1, randomize: false });
    plan.variants[0].coverageEvalArgs = ["eval", "coverage", "--latest-evidence-run"];

    const result = assertDiagnosticsPlan(plan);
    expect(result.passed).toBe(false);
    expect(result.reasons.join("\n")).toContain("latest");
    expect(result.reasons.join("\n")).toContain("--run-id");
  });

  it("worker config does not include other variants details", () => {
    const cwd = makeSourceRepo();
    const plan = buildDiagnosticsPlan({ command: "sdk-concurrency", cwd, concurrencyLevels: [1, 2], repeats: 1, randomize: false });
    const prompt = plan.variants[0].workerConfig.bucketPrompt;

    expect(prompt).not.toContain(plan.variants[1].variantId);
    expect(prompt).not.toContain(plan.variants[1].runId);
    expect(assertDiagnosticsPlan(plan).passed).toBe(true);
  });

  it("detects threadId cross-variant contamination", () => {
    const one = runMetric({ runId: "run-a", workers: [{ ...runMetric().workers[0], threadId: "shared-thread", variantId: "variant-a", runId: "run-a" }] });
    const two = runMetric({ runId: "run-b", workers: [{ ...runMetric().workers[0], threadId: "shared-thread", variantId: "variant-b", runId: "run-b" }] });

    expect(detectThreadContamination([one, two]).join("\n")).toContain("reused");
  });

  it("--execute is required for real SDK on non-mock diagnostics", async () => {
    const cwd = makeSourceRepo();
    await expect(runDiagnostics({ command: "sdk-concurrency", cwd, execute: true, realSdk: false, concurrencyLevels: [1], repeats: 1 })).rejects.toThrow("--real-sdk");
  });

  it("plan.json records randomized mode and --no-randomize keeps deterministic order", () => {
    const cwd = makeSourceRepo();
    const randomized = buildDiagnosticsPlan({ command: "sdk-concurrency", cwd, concurrencyLevels: [1, 2, 3], repeats: 2 });
    const deterministic = buildDiagnosticsPlan({ command: "sdk-concurrency", cwd, concurrencyLevels: [1, 2, 3], repeats: 2, randomize: false });

    expect(randomized.randomize).toBe(true);
    expect(deterministic.randomize).toBe(false);
    expect(deterministic.variants.map((variant) => variant.concurrencyLevel)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("runs.jsonl appends one JSON line per result", () => {
    const cwd = makeSourceRepo();
    const experiment = createDiagnosticExperiment({ cwd });
    appendDiagnosticRunResult(experiment.runsPath, runMetric({ runId: "run-a" }));
    appendDiagnosticRunResult(experiment.runsPath, runMetric({ runId: "run-b" }));

    const lines = readFileSync(experiment.runsPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).runId).toBe("run-a");
    expect(JSON.parse(lines[1]).runId).toBe("run-b");
  });

  it("summary helpers compute prompt width, bucket difficulty, and timeout sweep metrics", () => {
    const promptSummary = summarizePromptWidth([
      { ...runMetric({ status: "failed", durationMs: 2000, invalidJsonCount: 1 }), promptMode: "broad" },
      { ...runMetric({ status: "completed", durationMs: 1000 }), promptMode: "narrow" }
    ]);
    const bucketSummary = summarizeBucketDifficulty([
      runMetric({ workers: [{ ...runMetric().workers[0], bucket: "github", sourcesFoundCount: 2 }] }),
      runMetric({ workers: [{ ...runMetric().workers[0], bucket: "academic", status: "needs_resume", sourcesFoundCount: 0 }] })
    ]);
    const timeoutSummary = summarizeTimeoutSweep([
      { ...runMetric({ status: "failed", sourceCount: 0 }), timeoutLevelMs: 600000 },
      { ...runMetric({ status: "completed", sourceCount: 2 }), timeoutLevelMs: 1800000 }
    ]);

    expect(promptSummary.completionRateBroad).toBe(0);
    expect(promptSummary.completionRateNarrow).toBe(1);
    expect(JSON.stringify(bucketSummary)).toContain("github");
    expect(timeoutSummary.longerTimeoutIncreasesCompletionRate).toBe(true);
    expect(timeoutSummary.extraTimeYieldsMoreSources).toBe(true);
  });

  it("concurrency summary separates transient network errors from timeout attribution", () => {
    const low = runMetric({
      concurrencyLevel: 1,
      workers: [
        {
          ...runMetric().workers[0],
          status: "needs_resume",
          failureCategory: "transient_network_error",
          transientNetworkErrorCount: 1,
          retryCount: 2,
          retrySuccess: false,
          sourcesFoundCount: 0
        }
      ],
      totalRetryCount: 2,
      retriedWorkerCount: 1,
      workersFailedAfterRetry: 1
    });
    const high = runMetric({
      concurrencyLevel: 3,
      workers: [
        {
          ...runMetric().workers[0],
          status: "needs_resume",
          failureCategory: "transient_network_error",
          transientNetworkErrorCount: 1,
          retryCount: 1,
          retrySuccess: true,
          sourcesFoundCount: 1
        }
      ],
      totalRetryCount: 1,
      retriedWorkerCount: 1,
      workersRecoveredAfterRetry: 1
    });

    const summary = summarizeConcurrency([low, high]);
    const highSummary = (summary.byConcurrency as Array<Record<string, number>>).find((item) => item.concurrencyLevel === 3);

    expect(highSummary?.transientNetworkErrorRate).toBe(1);
    expect(highSummary?.timeoutRateExcludingTransient).toBe(0);
    expect((summary.conclusion as { concurrencyLikelyCause: boolean | null }).concurrencyLikelyCause).toBeNull();
  });

  it("concurrency summary reports progress rates and nudge recovery", () => {
    const worker = {
      ...runMetric().workers[0],
      status: "completed",
      checkpointNudgeCount: 1,
      checkpointNudgeSuccessCount: 1,
      noArtifactProgressCount: 1,
      progressCategory: "semantic_progress" as const,
      sourcesFoundCount: 1
    };
    const noSemanticWorker = {
      ...runMetric().workers[0],
      status: "needs_resume",
      noSemanticProgressCount: 1,
      progressCategory: "no_semantic_progress" as const,
      sourcesFoundCount: 0
    };
    const summary = summarizeConcurrency([
      runMetric({ concurrencyLevel: 1, workers: [runMetric().workers[0]] }),
      runMetric({ concurrencyLevel: 3, workers: [worker, noSemanticWorker], timeoutBucketCount: 1 })
    ]);
    const highSummary = (summary.byConcurrency as Array<Record<string, number>>).find((item) => item.concurrencyLevel === 3);

    expect(highSummary?.noArtifactProgressRate).toBe(0.5);
    expect(highSummary?.noSemanticProgressRate).toBe(0.5);
    expect(highSummary?.checkpointNudgeSuccessRate).toBe(1);
    expect(highSummary?.workersRecoveredByCheckpointNudge).toBe(1);
    expect((summary.conclusion as { evidence: string[] }).evidence.join(" ")).toContain("checkpoint nudge");
  });

  it("sdk-checkpoint-resume execute uses mock runner and records resume result", async () => {
    const cwd = makeSourceRepo();
    const result = await runDiagnostics({
      command: "sdk-checkpoint-resume",
      cwd,
      execute: true,
      realSdk: false,
      output: join(cwd, ".agent", "reports", "diagnostics", "checkpoint-summary.json"),
      workdirRoot: join(tmpdir(), "diag-checkpoint"),
      randomize: false
    });

    expect(result.runCount).toBe(1);
    expect(result.runResults[0].workers[0].resumedFromThreadId).toBeTruthy();
    expect(result.runResults[0].workers[0].threadId).toBe(result.runResults[0].workers[0].resumedFromThreadId);
    expect(result.contaminationDetected).toBe(false);
  });

  it("CLI dry-run does not start SDK threads and writes structured output", () => {
    const cwd = makeSourceRepo();
    const cli = spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), [join(process.cwd(), "src", "cli.ts"), "diagnostics", "sdk-concurrency", "--concurrency-levels", "1", "--repeats", "1", "--no-randomize"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, CODEX_HARDFLOW_HOME: mkdtempSync(join(tmpdir(), "hardflow-state-")) }
    });

    expect(cli.status).toBe(0);
    const parsed = JSON.parse(cli.stdout);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.runCount).toBe(0);
    expect(readFileSync(parsed.runsPath, "utf8")).toBe("");
  });
});
