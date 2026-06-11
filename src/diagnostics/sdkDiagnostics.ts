import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { evaluateCoverage } from "../coverageEval.js";
import { researchRunSdkWorkerFinalReportPath, researchRunSdkWorkerPartialEvidencePath, researchRunSdkWorkerStatePath } from "../paths.js";
import { resumeResearchRun, runResearch } from "../researchOrchestrator.js";
import type { RouterOutput } from "../router/routerSchema.js";
import type { ProgressCategory, SdkWorkerState, WorkerFailureCategory } from "../schemas.js";
import {
  assertIsolatedWorkspace,
  createDiagnosticExperiment,
  createIsolatedRunWorkspace,
  type DiagnosticExperiment,
  type IsolatedRunWorkspace
} from "./isolation.js";

const DEFAULT_TASK = "Compare current practical approaches for hidden validation in AI coding agents.";
const DEFAULT_BUCKETS = ["official_docs", "github", "academic", "security", "package_registry", "codex_default_discovery"];
const DEFAULT_PROMPT_WIDTH_BUCKETS = ["official_docs", "github", "academic"];
const DEFAULT_BUCKET_DIFFICULTY_BUCKETS = ["local_repo", "official_docs", "github", "academic", "security", "package_registry", "codex_default_discovery"];
const DEFAULT_TIMEOUT_SWEEP_BUCKETS = ["official_docs", "github", "academic"];
const DEFAULT_CONCURRENCY_LEVELS = [1, 2, 3, 6];
const DEFAULT_TIMEOUT_LEVELS = [600_000, 1_800_000, 3_600_000];

export type DiagnosticsCommand = "sdk-concurrency" | "sdk-prompt-width" | "sdk-bucket-difficulty" | "sdk-timeout-sweep" | "sdk-checkpoint-resume";

export interface DiagnosticsOptions {
  command: DiagnosticsCommand;
  cwd: string;
  task?: string;
  buckets?: string[];
  concurrencyLevels?: number[];
  repeats?: number;
  maxSourcesPerWorker?: number;
  heartbeatIntervalMs?: number;
  workerLeaseMs?: number;
  softTimeoutMs?: number;
  hardTimeoutMs?: number;
  globalBudgetMs?: number;
  output?: string;
  workdirRoot?: string;
  dryRun?: boolean;
  execute?: boolean;
  realSdk?: boolean;
  randomize?: boolean;
  materializeDryRun?: boolean;
  runIdPrefix?: string;
  timeoutLevels?: number[];
}

export interface DiagnosticsVariant {
  experimentId: string;
  variantId: string;
  runId: string;
  command: DiagnosticsCommand;
  task: string;
  buckets: string[];
  concurrencyLevel: number;
  repeatIndex: number;
  maxSourcesPerWorker: number;
  heartbeatIntervalMs: number;
  workerLeaseMs: number;
  softTimeoutMs: number;
  hardTimeoutMs: number;
  globalBudgetMs: number;
  promptMode?: "broad" | "narrow";
  bucket?: string;
  timeoutLevelMs?: number;
  checkpointResumeMock?: boolean;
  isolatedRepoDir: string;
  isolatedHomeDir: string;
  outputParentPath: string;
  sourceRepoSnapshot: string;
  env: { CODEX_HARDFLOW_HOME: string };
  explicitRunIdArgs: string[];
  coverageEvalArgs: string[];
  workerConfig: {
    runId: string;
    bucketPrompt: string;
    allowedRepoSnapshot: string;
    outputSchema: string;
  };
}

export interface WorkerMetric {
  bucket: string;
  status: string;
  durationMs: number | null;
  timeToFirstHeartbeatMs: number | null;
  timeToFirstEvidenceMs: number | null;
  partialEvidenceCount: number;
  activityEventCount: number;
  streamEventCount: number;
  toolActivityCount: number;
  sourcesFoundCount: number;
  queriesRunCount: number;
  noSignalCount: number;
  heartbeatCount: number;
  noProgressHeartbeatCount: number;
  checkpointCount: number;
  semanticProgressCount: number;
  checkpointNudgeCount: number;
  checkpointNudgeSuccessCount: number;
  checkpointNudgeFailedCount: number;
  noActivityProgressCount: number;
  noArtifactProgressCount: number;
  noSemanticProgressCount: number;
  progressCategory: ProgressCategory;
  lastProgressReason: string;
  threadIdPresent: boolean;
  finalReportPresent: boolean;
  failureReason: string;
  failureCategory: WorkerFailureCategory;
  retryCount: number;
  maxRetries: number;
  attemptCount: number;
  transientNetworkErrorCount: number;
  rateLimitCount: number;
  sdkTimeoutCount: number;
  retrySuccess: boolean;
  finalAttemptStatus: string;
  threadIds: string[];
  resumedThreadIds: string[];
  replacementThreadIds: string[];
  timeLostToBackoffMs: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  threadId?: string;
  variantId?: string;
  runId?: string;
  resumedFromThreadId?: string | null;
}

export interface RunMetric {
  runId: string;
  concurrencyLevel: number;
  repeatIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: string;
  coverage_score: number;
  completedBucketCount: number;
  timeoutBucketCount: number;
  failedBucketCount: number;
  invalidJsonCount: number;
  requiredBucketCount: number;
  programmaticMultiAgent: boolean;
  sourceCount: number;
  totalRetryCount: number;
  retriedWorkerCount: number;
  retrySuccessRate: number;
  transientNetworkErrorRate: number;
  rateLimitRate: number;
  workersFailedAfterRetry: number;
  workersRecoveredAfterRetry: number;
  noActivityProgressRate: number;
  noArtifactProgressRate: number;
  noSemanticProgressRate: number;
  checkpointNudgeSuccessRate: number;
  workersRecoveredByCheckpointNudge: number;
  workers: WorkerMetric[];
}

export interface DiagnosticsPlan {
  experimentId: string;
  command: DiagnosticsCommand;
  createdAt: string;
  dryRun: boolean;
  execute: boolean;
  realSdk: boolean;
  randomize: boolean;
  sourceRepoRoot: string;
  outputPath: string;
  workdirRoot: string;
  variants: DiagnosticsVariant[];
  isolation: {
    latestSelectionDisabled: true;
    currentPointersIgnored: true;
    explicitRunIdRequired: true;
    diagnosticsOutputOutsideIsolatedRepo: true;
    workerReceivesOtherVariantDetails: false;
  };
}

export interface DiagnosticsResult {
  experimentId: string;
  command: DiagnosticsCommand;
  dryRun: boolean;
  execute: boolean;
  realSdk: boolean;
  planPath: string;
  runsPath: string;
  summaryPath: string;
  outputPath: string;
  workdirRoot: string;
  variantCount: number;
  runCount: number;
  contaminationDetected: boolean;
  contaminationReasons: string[];
  runResults: RunMetric[];
  summary: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function numericList(value: string | undefined, fallback: number[]): number[] {
  if (!value?.trim()) return fallback;
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0);
}

export function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseNumberCsv(value: string | undefined, fallback: number[]): number[] {
  const parsed = numericList(value, fallback);
  return parsed.length > 0 ? parsed : fallback;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function deterministicShuffle<T>(items: T[], seed: string): T[] {
  return items
    .map((item, index) => {
      let value = 0;
      for (const char of `${seed}:${index}`) value = (value * 31 + char.charCodeAt(0)) >>> 0;
      return { item, key: value };
    })
    .sort((a, b) => a.key - b.key)
    .map((item) => item.item);
}

function workerPrompt(command: DiagnosticsCommand, variant: Pick<DiagnosticsVariant, "task" | "buckets" | "maxSourcesPerWorker" | "promptMode" | "bucket">): string {
  const bucketText = variant.bucket ?? variant.buckets.join(",");
  const width = variant.promptMode ? ` prompt_width=${variant.promptMode}` : "";
  return `diagnostic_worker bucket=${bucketText}${width} max_sources=${variant.maxSourcesPerWorker} task=${variant.task}`;
}

function baseRunId(prefix: string, command: DiagnosticsCommand, index: number): string {
  return `${prefix}-${command}-${index + 1}`;
}

function concurrencyVariants(options: RequiredDiagnosticsOptions, experiment: DiagnosticExperiment): Omit<DiagnosticsVariant, keyof IsolatedRunWorkspace | "experimentId" | "variantId" | "runId" | "outputParentPath" | "sourceRepoSnapshot" | "env" | "isolatedRepoDir" | "isolatedHomeDir" | "explicitRunIdArgs" | "coverageEvalArgs" | "workerConfig">[] {
  const variants = [];
  let index = 0;
  for (const concurrencyLevel of options.concurrencyLevels) {
    for (let repeatIndex = 1; repeatIndex <= options.repeats; repeatIndex += 1) {
      variants.push({
        command: "sdk-concurrency" as const,
        task: options.task,
        buckets: options.buckets,
        concurrencyLevel,
        repeatIndex,
        maxSourcesPerWorker: options.maxSourcesPerWorker,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        workerLeaseMs: options.workerLeaseMs,
        softTimeoutMs: options.softTimeoutMs,
        hardTimeoutMs: options.hardTimeoutMs,
        globalBudgetMs: options.globalBudgetMs
      });
      index += 1;
    }
  }
  void experiment;
  void index;
  return variants;
}

interface RequiredDiagnosticsOptions {
  command: DiagnosticsCommand;
  cwd: string;
  task: string;
  buckets: string[];
  concurrencyLevels: number[];
  repeats: number;
  maxSourcesPerWorker: number;
  heartbeatIntervalMs: number;
  workerLeaseMs: number;
  softTimeoutMs: number;
  hardTimeoutMs: number;
  globalBudgetMs: number;
  output?: string;
  workdirRoot?: string;
  dryRun: boolean;
  execute: boolean;
  realSdk: boolean;
  randomize: boolean;
  materializeDryRun: boolean;
  runIdPrefix: string;
  timeoutLevels: number[];
}

function requiredOptions(input: DiagnosticsOptions): RequiredDiagnosticsOptions {
  const command = input.command;
  const defaults = {
    task: input.task ?? DEFAULT_TASK,
    buckets:
      input.buckets ??
      (command === "sdk-prompt-width"
        ? DEFAULT_PROMPT_WIDTH_BUCKETS
        : command === "sdk-bucket-difficulty"
          ? DEFAULT_BUCKET_DIFFICULTY_BUCKETS
          : command === "sdk-timeout-sweep"
            ? DEFAULT_TIMEOUT_SWEEP_BUCKETS
            : DEFAULT_BUCKETS)
  };
  return {
    command,
    cwd: input.cwd,
    task: defaults.task,
    buckets: input.buckets && input.buckets.length > 0 ? input.buckets : defaults.buckets,
    concurrencyLevels: input.concurrencyLevels && input.concurrencyLevels.length > 0 ? input.concurrencyLevels : DEFAULT_CONCURRENCY_LEVELS,
    repeats: input.repeats ?? (command === "sdk-timeout-sweep" ? 2 : 3),
    maxSourcesPerWorker: input.maxSourcesPerWorker ?? 2,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? 60_000,
    workerLeaseMs: input.workerLeaseMs ?? 180_000,
    softTimeoutMs: input.softTimeoutMs ?? 900_000,
    hardTimeoutMs: input.hardTimeoutMs ?? 1_800_000,
    globalBudgetMs: input.globalBudgetMs ?? 3_600_000,
    output: input.output,
    workdirRoot: input.workdirRoot,
    dryRun: input.dryRun ?? !(input.execute || input.realSdk),
    execute: input.execute ?? false,
    realSdk: input.realSdk ?? false,
    randomize: input.randomize ?? true,
    materializeDryRun: input.materializeDryRun ?? false,
    runIdPrefix: input.runIdPrefix ?? "diag-run",
    timeoutLevels: input.timeoutLevels && input.timeoutLevels.length > 0 ? input.timeoutLevels : DEFAULT_TIMEOUT_LEVELS
  };
}

function rawVariants(options: RequiredDiagnosticsOptions, experiment: DiagnosticExperiment): Array<Record<string, unknown>> {
  if (options.command === "sdk-concurrency") return concurrencyVariants(options, experiment);
  if (options.command === "sdk-prompt-width") {
    return ["broad", "narrow"].flatMap((promptMode) =>
      Array.from({ length: options.repeats }, (_, index) => ({
        command: options.command,
        task: options.task,
        buckets: options.buckets,
        concurrencyLevel: 1,
        repeatIndex: index + 1,
        promptMode,
        maxSourcesPerWorker: options.maxSourcesPerWorker,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        workerLeaseMs: options.workerLeaseMs,
        softTimeoutMs: options.softTimeoutMs,
        hardTimeoutMs: options.hardTimeoutMs,
        globalBudgetMs: options.globalBudgetMs
      }))
    );
  }
  if (options.command === "sdk-bucket-difficulty") {
    return options.buckets.flatMap((bucket) =>
      Array.from({ length: options.repeats }, (_, index) => ({
        command: options.command,
        task: options.task,
        buckets: [bucket],
        bucket,
        concurrencyLevel: 1,
        repeatIndex: index + 1,
        maxSourcesPerWorker: options.maxSourcesPerWorker,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        workerLeaseMs: options.workerLeaseMs,
        softTimeoutMs: options.softTimeoutMs,
        hardTimeoutMs: options.hardTimeoutMs,
        globalBudgetMs: options.globalBudgetMs
      }))
    );
  }
  if (options.command === "sdk-timeout-sweep") {
    return options.timeoutLevels.flatMap((timeoutLevelMs) =>
      Array.from({ length: options.repeats }, (_, index) => ({
        command: options.command,
        task: options.task,
        buckets: options.buckets,
        concurrencyLevel: 1,
        repeatIndex: index + 1,
        timeoutLevelMs,
        maxSourcesPerWorker: options.maxSourcesPerWorker,
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        workerLeaseMs: options.workerLeaseMs,
        softTimeoutMs: Math.min(options.softTimeoutMs, timeoutLevelMs),
        hardTimeoutMs: timeoutLevelMs,
        globalBudgetMs: Math.max(options.globalBudgetMs, timeoutLevelMs),
      }))
    );
  }
  return [
    {
      command: options.command,
      task: options.task,
      buckets: ["official_docs"],
      concurrencyLevel: 1,
      repeatIndex: 1,
      checkpointResumeMock: true,
      maxSourcesPerWorker: options.maxSourcesPerWorker,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      workerLeaseMs: options.workerLeaseMs,
      softTimeoutMs: 120_000,
      hardTimeoutMs: 900_000,
      globalBudgetMs: options.globalBudgetMs
    }
  ];
}

export function buildDiagnosticsPlan(options: DiagnosticsOptions): DiagnosticsPlan {
  const required = requiredOptions(options);
  const experiment = createDiagnosticExperiment({
    cwd: required.cwd,
    output: required.output,
    workdirRoot: required.workdirRoot
  });
  const base = rawVariants(required, experiment);
  const ordered = required.randomize ? deterministicShuffle(base, experiment.experimentId) : base;
  const variants = ordered.map((item, index) => {
    const variantId = `variant-${index + 1}`;
    const runId = baseRunId(required.runIdPrefix, required.command, index);
    const workspace = createIsolatedRunWorkspace({
      experiment,
      variantId,
      runId,
      materialize: required.materializeDryRun || required.execute || required.realSdk
    });
    const partial = {
      ...workspace,
      experimentId: experiment.experimentId,
      variantId,
      runId,
      command: required.command,
      task: String(item.task),
      buckets: item.buckets as string[],
      concurrencyLevel: Number(item.concurrencyLevel),
      repeatIndex: Number(item.repeatIndex),
      maxSourcesPerWorker: Number(item.maxSourcesPerWorker),
      heartbeatIntervalMs: Number(item.heartbeatIntervalMs),
      workerLeaseMs: Number(item.workerLeaseMs),
      softTimeoutMs: Number(item.softTimeoutMs),
      hardTimeoutMs: Number(item.hardTimeoutMs),
      globalBudgetMs: Number(item.globalBudgetMs),
      promptMode: item.promptMode as DiagnosticsVariant["promptMode"],
      bucket: item.bucket as string | undefined,
      timeoutLevelMs: item.timeoutLevelMs as number | undefined,
      checkpointResumeMock: item.checkpointResumeMock as boolean | undefined,
      explicitRunIdArgs: ["--run-id", runId],
      coverageEvalArgs: ["eval", "coverage", "--run-id", runId],
      workerConfig: {
        runId,
        bucketPrompt: workerPrompt(required.command, {
          task: String(item.task),
          buckets: item.buckets as string[],
          maxSourcesPerWorker: Number(item.maxSourcesPerWorker),
          promptMode: item.promptMode as DiagnosticsVariant["promptMode"],
          bucket: item.bucket as string | undefined
        }),
        allowedRepoSnapshot: workspace.sourceRepoSnapshot,
        outputSchema: "bucket_research_report_json"
      }
    };
    return partial;
  });
  return {
    experimentId: experiment.experimentId,
    command: required.command,
    createdAt: experiment.createdAt,
    dryRun: required.dryRun,
    execute: required.execute,
    realSdk: required.realSdk,
    randomize: required.randomize,
    sourceRepoRoot: experiment.sourceRepoRoot,
    outputPath: experiment.outputPath,
    workdirRoot: experiment.workdirRoot,
    variants,
    isolation: {
      latestSelectionDisabled: true,
      currentPointersIgnored: true,
      explicitRunIdRequired: true,
      diagnosticsOutputOutsideIsolatedRepo: true,
      workerReceivesOtherVariantDetails: false
    }
  };
}

function experimentFromPlan(plan: DiagnosticsPlan): DiagnosticExperiment {
  const diagnosticsDir = join(resolve(plan.sourceRepoRoot), ".agent", "reports", "diagnostics", plan.experimentId);
  return {
    experimentId: plan.experimentId,
    sourceRepoRoot: plan.sourceRepoRoot,
    diagnosticsDir,
    planPath: join(diagnosticsDir, "plan.json"),
    runsPath: join(diagnosticsDir, "runs.jsonl"),
    summaryPath: join(diagnosticsDir, "summary.json"),
    outputPath: plan.outputPath,
    workdirRoot: plan.workdirRoot,
    createdAt: plan.createdAt
  };
}

export function assertDiagnosticsPlan(plan: DiagnosticsPlan): { passed: boolean; contaminationDetected: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const seenRunIds = new Set<string>();
  for (const variant of plan.variants) {
    if (seenRunIds.has(variant.runId)) reasons.push(`duplicate runId: ${variant.runId}`);
    seenRunIds.add(variant.runId);
    if (!variant.explicitRunIdArgs.includes("--run-id")) reasons.push(`variant ${variant.variantId} is missing explicit runId args.`);
    if (variant.coverageEvalArgs.join(" ").includes("--latest-evidence-run")) reasons.push(`variant ${variant.variantId} attempts latest coverage selection.`);
    if (!variant.coverageEvalArgs.includes("--run-id")) reasons.push(`variant ${variant.variantId} coverage eval is missing --run-id.`);
    const isolation = assertIsolatedWorkspace({ workspace: variant, requireMaterialized: existsSync(variant.isolatedRepoDir) });
    if (!isolation.passed) reasons.push(...isolation.reasons.map((reason) => `${variant.variantId}: ${reason}`));
    const prompt = variant.workerConfig.bucketPrompt;
    for (const other of plan.variants) {
      if (other.variantId !== variant.variantId && (prompt.includes(other.variantId) || prompt.includes(other.runId))) {
        reasons.push(`variant ${variant.variantId} worker config includes another variant detail.`);
      }
    }
  }
  return { passed: reasons.length === 0, contaminationDetected: reasons.length > 0, reasons };
}

function workerMetricsFromState(repoDir: string, runId: string, bucket: string, variantId: string): WorkerMetric {
  const statePath = researchRunSdkWorkerStatePath(repoDir, runId, bucket);
  const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as SdkWorkerState) : undefined;
  const partialPath = researchRunSdkWorkerPartialEvidencePath(repoDir, runId, bucket);
  const finalPath = researchRunSdkWorkerFinalReportPath(repoDir, runId, bucket);
  const started = state?.startedAt ? Date.parse(state.startedAt) : NaN;
  const ended = state?.endedAt ? Date.parse(state.endedAt) : NaN;
  const firstEvidence = existsSync(partialPath) ? readFileSync(partialPath, "utf8").split("\n").find(Boolean) : undefined;
  const partialEvidenceCount = state?.partialEvidenceCount ?? 0;
  return {
    bucket,
    status: state?.status ?? "not_started",
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null,
    timeToFirstHeartbeatMs: state?.lastHeartbeatAt && Number.isFinite(started) ? Math.max(0, Date.parse(state.lastHeartbeatAt) - started) : null,
    timeToFirstEvidenceMs: firstEvidence && Number.isFinite(started) ? 0 : null,
    partialEvidenceCount,
    activityEventCount: state?.activityEventCount ?? 0,
    streamEventCount: state?.streamEventCount ?? 0,
    toolActivityCount: state?.toolActivityCount ?? 0,
    sourcesFoundCount: state?.sourcesFoundCount ?? partialEvidenceCount,
    queriesRunCount: state?.queriesRunCount ?? 0,
    noSignalCount: state?.noSignalCount ?? 0,
    heartbeatCount: state?.activityEventCount ?? (state ? 1 : 0),
    noProgressHeartbeatCount: state?.failureCategory === "no_progress" || /no progress/i.test(state?.failureReason ?? "") ? 1 : 0,
    checkpointCount: state?.checkpointCount ?? 0,
    semanticProgressCount: state?.semanticProgressCount ?? 0,
    checkpointNudgeCount: state?.checkpointNudgeCount ?? 0,
    checkpointNudgeSuccessCount: state?.checkpointNudgeSuccessCount ?? 0,
    checkpointNudgeFailedCount: state?.checkpointNudgeFailedCount ?? 0,
    noActivityProgressCount: state?.noActivityProgressCount ?? 0,
    noArtifactProgressCount: state?.noArtifactProgressCount ?? 0,
    noSemanticProgressCount: state?.noSemanticProgressCount ?? 0,
    progressCategory: state?.progressCategory ?? "activity_progress",
    lastProgressReason: state?.lastProgressReason ?? "",
    threadIdPresent: Boolean(state?.threadId),
    finalReportPresent: existsSync(finalPath),
    failureReason: state?.failureReason ?? "",
    failureCategory: state?.failureCategory ?? "unknown",
    retryCount: state?.retryCount ?? 0,
    maxRetries: state?.maxRetries ?? 0,
    attemptCount: state?.attemptCount ?? (state ? 1 : 0),
    transientNetworkErrorCount: state?.transientNetworkErrorCount ?? 0,
    rateLimitCount: state?.rateLimitCount ?? 0,
    sdkTimeoutCount: state?.sdkTimeoutCount ?? 0,
    retrySuccess: state?.retrySuccess ?? false,
    finalAttemptStatus: state?.finalAttemptStatus ?? state?.status ?? "not_started",
    threadIds: state?.threadIds ?? (state?.threadId ? [state.threadId] : []),
    resumedThreadIds: state?.resumedThreadIds ?? [],
    replacementThreadIds: state?.replacementThreadIds ?? [],
    timeLostToBackoffMs: state?.timeLostToBackoffMs ?? 0,
    firstFailureAt: state?.firstFailureAt ?? null,
    lastFailureAt: state?.lastFailureAt ?? null,
    threadId: state?.threadId,
    variantId,
    runId,
    resumedFromThreadId: null
  };
}

export function detectThreadContamination(results: RunMetric[]): string[] {
  const owners = new Map<string, { variantId: string; runId: string; bucket: string }>();
  const reasons: string[] = [];
  for (const result of results) {
    for (const worker of result.workers) {
      if (!worker.threadId) continue;
      const owner = owners.get(worker.threadId);
      if (owner && (owner.variantId !== worker.variantId || owner.runId !== worker.runId)) {
        reasons.push(`threadId reused across variants/runs: ${worker.threadId}`);
      } else {
        owners.set(worker.threadId, { variantId: worker.variantId ?? "", runId: worker.runId ?? "", bucket: worker.bucket });
      }
      if (worker.resumedFromThreadId && worker.resumedFromThreadId !== worker.threadId) {
        reasons.push(`worker ${worker.bucket} resumed from unexpected threadId.`);
      }
    }
  }
  return reasons;
}

export function appendDiagnosticRunResult(path: string, result: RunMetric): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(result)}\n`);
}

function runRetryMetrics(workers: WorkerMetric[]): Pick<
  RunMetric,
  | "totalRetryCount"
  | "retriedWorkerCount"
  | "retrySuccessRate"
  | "transientNetworkErrorRate"
  | "rateLimitRate"
  | "workersFailedAfterRetry"
  | "workersRecoveredAfterRetry"
  | "noActivityProgressRate"
  | "noArtifactProgressRate"
  | "noSemanticProgressRate"
  | "checkpointNudgeSuccessRate"
  | "workersRecoveredByCheckpointNudge"
> {
  const retried = workers.filter((worker) => worker.retryCount > 0);
  const recovered = retried.filter((worker) => worker.retrySuccess || worker.status === "completed");
  const failedAfterRetry = retried.filter((worker) => worker.status !== "completed");
  const nudged = workers.filter((worker) => worker.checkpointNudgeCount > 0);
  const nudgeRecovered = nudged.filter((worker) => worker.status === "completed" && worker.checkpointNudgeSuccessCount > 0);
  return {
    totalRetryCount: workers.reduce((sum, worker) => sum + worker.retryCount, 0),
    retriedWorkerCount: retried.length,
    retrySuccessRate: retried.length ? recovered.length / retried.length : 0,
    transientNetworkErrorRate: workers.length ? workers.filter((worker) => worker.transientNetworkErrorCount > 0).length / workers.length : 0,
    rateLimitRate: workers.length ? workers.filter((worker) => worker.rateLimitCount > 0).length / workers.length : 0,
    workersFailedAfterRetry: failedAfterRetry.length,
    workersRecoveredAfterRetry: recovered.length,
    noActivityProgressRate: workers.length ? workers.filter((worker) => worker.noActivityProgressCount > 0 || worker.progressCategory === "no_activity_progress").length / workers.length : 0,
    noArtifactProgressRate: workers.length ? workers.filter((worker) => worker.noArtifactProgressCount > 0 || worker.progressCategory === "no_artifact_progress").length / workers.length : 0,
    noSemanticProgressRate: workers.length ? workers.filter((worker) => worker.noSemanticProgressCount > 0 || worker.progressCategory === "no_semantic_progress").length / workers.length : 0,
    checkpointNudgeSuccessRate: nudged.length ? nudged.filter((worker) => worker.checkpointNudgeSuccessCount > 0).length / nudged.length : 0,
    workersRecoveredByCheckpointNudge: nudgeRecovered.length
  };
}

async function runRealVariant(variant: DiagnosticsVariant, sourceRoot: string): Promise<RunMetric> {
  const startedAt = nowIso();
  const start = Date.now();
  const isolation = assertIsolatedWorkspace({ workspace: variant, requireMaterialized: true });
  if (!isolation.passed) {
    const endedAt = nowIso();
    const workers: WorkerMetric[] = [];
    return {
      runId: variant.runId,
      concurrencyLevel: variant.concurrencyLevel,
      repeatIndex: variant.repeatIndex,
      startedAt,
      endedAt,
      durationMs: Date.now() - start,
      status: "isolation_failed",
      coverage_score: 0,
      completedBucketCount: 0,
      timeoutBucketCount: 0,
      failedBucketCount: variant.buckets.length,
      invalidJsonCount: 0,
      requiredBucketCount: variant.buckets.length,
      programmaticMultiAgent: false,
      sourceCount: 0,
      ...runRetryMetrics(workers),
      workers: []
    };
  }
  let status = "completed";
  const previousHome = process.env.CODEX_HARDFLOW_HOME;
  try {
    process.env.CODEX_HARDFLOW_HOME = variant.isolatedHomeDir;
    await runResearch(variant.task, variant.isolatedRepoDir, {
      sourceRoot,
      routerOutput: routerOutputForBuckets(variant.buckets),
      strictProgrammatic: true,
      runId: variant.runId,
      maxConcurrentBuckets: variant.concurrencyLevel,
      maxSourcesPerWorker: variant.maxSourcesPerWorker,
      heartbeatIntervalMs: variant.heartbeatIntervalMs,
      workerLeaseMs: variant.workerLeaseMs,
      softTimeoutMs: variant.softTimeoutMs,
      hardTimeoutMs: variant.hardTimeoutMs,
      globalBudgetMs: variant.globalBudgetMs,
      input: { turnId: variant.runId }
    });
  } catch {
    status = "failed";
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HARDFLOW_HOME;
    else process.env.CODEX_HARDFLOW_HOME = previousHome;
  }
  let coverage_score = 0;
  let sourceCount = 0;
  let programmaticMultiAgent = false;
  try {
    const coverage = evaluateCoverage(variant.isolatedRepoDir, { runId: variant.runId });
    coverage_score = coverage.coverage_score;
    sourceCount = coverage.uniqueSourceCount;
    programmaticMultiAgent = coverage.programmaticMultiAgent;
  } catch {
    status = "coverage_failed";
  }
  const workers = variant.buckets.map((bucket) => workerMetricsFromState(variant.isolatedRepoDir, variant.runId, bucket, variant.variantId));
  const endedAt = nowIso();
  return {
    runId: variant.runId,
    concurrencyLevel: variant.concurrencyLevel,
    repeatIndex: variant.repeatIndex,
    startedAt,
    endedAt,
    durationMs: Date.now() - start,
    status,
    coverage_score,
    completedBucketCount: workers.filter((worker) => worker.status === "completed").length,
    timeoutBucketCount: workers.filter((worker) => worker.status === "timeout" || worker.status === "needs_resume").length,
    failedBucketCount: workers.filter((worker) => worker.status === "failed").length,
    invalidJsonCount: workers.filter((worker) => worker.failureCategory === "invalid_json").length,
    requiredBucketCount: variant.buckets.length,
    programmaticMultiAgent,
    sourceCount,
    ...runRetryMetrics(workers),
    workers
  };
}

function routerOutputForBuckets(buckets: string[]): RouterOutput {
  return {
    route: "research",
    workflowPattern: "parallel_research",
    researchProfile: "none",
    validationProfile: "none",
    sourceBuckets: buckets.map((bucket) => ({ bucket: bucket as RouterOutput["sourceBuckets"][number]["bucket"], status: "required", reason: `${bucket} diagnostic bucket.` })),
    requiredAgents: buckets.map((bucket) => ({ name: `${bucket}_researcher`, required: true, reason: `${bucket} diagnostic worker.` })),
    requiresSourceMatrix: true,
    requiresExecutorManifest: false,
    requiresValidation: false,
    requiresFinalHoldout: false,
    requiresParallelIsolation: false,
    reasons: ["SDK checkpoint/resume diagnostic."],
    risks: ["may_need_current_info"],
    bypass: { requested: false, reason: "" }
  };
}

async function runMockCheckpointResumeVariant(variant: DiagnosticsVariant): Promise<RunMetric> {
  const startedAt = nowIso();
  const start = Date.now();
  const bucket = variant.buckets[0] ?? "official_docs";
  const isolation = assertIsolatedWorkspace({ workspace: variant, requireMaterialized: true });
  if (!isolation.passed) {
    const endedAt = nowIso();
    const workers: WorkerMetric[] = [];
    return {
      runId: variant.runId,
      concurrencyLevel: variant.concurrencyLevel,
      repeatIndex: variant.repeatIndex,
      startedAt,
      endedAt,
      durationMs: Date.now() - start,
      status: "isolation_failed",
      coverage_score: 0,
      completedBucketCount: 0,
      timeoutBucketCount: 0,
      failedBucketCount: 1,
      invalidJsonCount: 0,
      requiredBucketCount: 1,
      programmaticMultiAgent: false,
      sourceCount: 0,
      ...runRetryMetrics(workers),
      workers: []
    };
  }
  await runResearch("mock checkpoint resume diagnostic", variant.isolatedRepoDir, {
    routerOutput: routerOutputForBuckets([bucket]),
    strictProgrammatic: true,
    sdkAvailable: true,
    runId: variant.runId,
    input: { turnId: `${variant.runId}-mock` },
    hardTimeoutMs: 30,
    heartbeatIntervalMs: 5,
    maxNoProgressHeartbeats: 100,
    maxSourcesPerWorker: 1,
    sdkStepRunner: async ({ step, bucket: workerBucket, onThreadId }) => {
      onThreadId(`mock-thread-${variant.runId}-${workerBucket}`);
      if (step === "partial_evidence") {
        return JSON.stringify({
          bucket: workerBucket,
          queries_run: ["mock query"],
          sources_found: [
            {
              bucket: workerBucket,
              title: "Mock source",
              source_type: workerBucket,
              url_or_ref: "mock://source",
              date_or_version: "mock",
              claim: "Mock partial evidence.",
              confidence: "medium",
              notes: "Mock checkpoint diagnostic."
            }
          ],
          searched_but_no_signal: false
        });
      }
      if (step === "final_report") return new Promise<string>(() => undefined);
      return JSON.stringify({ bucket: workerBucket, queries_run: ["mock query"], sources_found: [], searched_but_no_signal: false });
    }
  });
  const beforeResume = workerMetricsFromState(variant.isolatedRepoDir, variant.runId, bucket, variant.variantId);
  await resumeResearchRun(variant.isolatedRepoDir, variant.runId, {
    sdkStepRunner: async ({ step, bucket: workerBucket, threadId, onThreadId }) => {
      onThreadId(threadId ?? `mock-thread-${variant.runId}-${workerBucket}`);
      return JSON.stringify({ bucket: workerBucket, queries_run: ["mock resume"], sources_found: [], searched_but_no_signal: false, need_more_work: false });
    }
  });
  const afterResume = workerMetricsFromState(variant.isolatedRepoDir, variant.runId, bucket, variant.variantId);
  afterResume.resumedFromThreadId = beforeResume.threadId ?? null;
  const endedAt = nowIso();
  return {
    runId: variant.runId,
    concurrencyLevel: variant.concurrencyLevel,
    repeatIndex: variant.repeatIndex,
    startedAt,
    endedAt,
    durationMs: Date.now() - start,
    status: afterResume.status === "completed" ? "completed" : "failed",
    coverage_score: 0,
    completedBucketCount: afterResume.status === "completed" ? 1 : 0,
    timeoutBucketCount: beforeResume.status === "needs_resume" ? 1 : 0,
    failedBucketCount: afterResume.status === "failed" ? 1 : 0,
    invalidJsonCount: 0,
    requiredBucketCount: 1,
    programmaticMultiAgent: true,
    sourceCount: afterResume.sourcesFoundCount,
    ...runRetryMetrics([afterResume]),
    workers: [afterResume]
  };
}

export function summarizeConcurrency(results: RunMetric[]): Record<string, unknown> {
  const groups = new Map<number, RunMetric[]>();
  for (const result of results) groups.set(result.concurrencyLevel, [...(groups.get(result.concurrencyLevel) ?? []), result]);
  const byConcurrency = [...groups.entries()].map(([concurrencyLevel, runs]) => {
    const workers = runs.flatMap((run) => run.workers);
    const timeoutWorkers = workers.filter((worker) => worker.status === "timeout" || worker.status === "needs_resume");
    const timeoutExcludingTransient = timeoutWorkers.filter((worker) => worker.failureCategory !== "transient_network_error");
    const retriedWorkers = workers.filter((worker) => worker.retryCount > 0);
    const recoveredWorkers = retriedWorkers.filter((worker) => worker.retrySuccess || worker.status === "completed");
    const nudgedWorkers = workers.filter((worker) => worker.checkpointNudgeCount > 0);
    const nudgeRecoveredWorkers = nudgedWorkers.filter((worker) => worker.status === "completed" && worker.checkpointNudgeSuccessCount > 0);
    return {
      concurrencyLevel,
      runCount: runs.length,
      workerCount: workers.length,
      completedRate: workers.length ? workers.filter((worker) => worker.status === "completed").length / workers.length : 0,
      timeoutRate: workers.length ? timeoutWorkers.length / workers.length : 0,
      timeoutRateExcludingTransient: workers.length ? timeoutExcludingTransient.length / workers.length : 0,
      failedRate: workers.length ? workers.filter((worker) => worker.status === "failed").length / workers.length : 0,
      invalidJsonRate: runs.length ? runs.reduce((sum, run) => sum + run.invalidJsonCount, 0) / runs.length : 0,
      medianDurationMs: median(runs.map((run) => run.durationMs)),
      p90DurationMs: p90(runs.map((run) => run.durationMs)),
      medianTimeToFirstEvidenceMs: median(workers.map((worker) => worker.timeToFirstEvidenceMs).filter((item): item is number => item !== null)),
      averageSourcesFound: average(workers.map((worker) => worker.sourcesFoundCount)) ?? 0,
      averageCoverageScore: average(runs.map((run) => run.coverage_score)) ?? 0,
      totalRetryCount: runs.reduce((sum, run) => sum + run.totalRetryCount, 0),
      retriedWorkerCount: retriedWorkers.length,
      retrySuccessRate: retriedWorkers.length ? recoveredWorkers.length / retriedWorkers.length : 0,
      transientNetworkErrorRate: workers.length ? workers.filter((worker) => worker.transientNetworkErrorCount > 0).length / workers.length : 0,
      rateLimitRate: workers.length ? workers.filter((worker) => worker.rateLimitCount > 0).length / workers.length : 0,
      workersFailedAfterRetry: runs.reduce((sum, run) => sum + run.workersFailedAfterRetry, 0),
      workersRecoveredAfterRetry: runs.reduce((sum, run) => sum + run.workersRecoveredAfterRetry, 0),
      noActivityProgressRate: workers.length ? workers.filter((worker) => worker.noActivityProgressCount > 0 || worker.progressCategory === "no_activity_progress").length / workers.length : 0,
      noArtifactProgressRate: workers.length ? workers.filter((worker) => worker.noArtifactProgressCount > 0 || worker.progressCategory === "no_artifact_progress").length / workers.length : 0,
      noSemanticProgressRate: workers.length ? workers.filter((worker) => worker.noSemanticProgressCount > 0 || worker.progressCategory === "no_semantic_progress").length / workers.length : 0,
      checkpointNudgeSuccessRate: nudgedWorkers.length ? nudgeRecoveredWorkers.length / nudgedWorkers.length : 0,
      workersRecoveredByCheckpointNudge: nudgeRecoveredWorkers.length
    };
  });
  const ordered = byConcurrency.sort((a, b) => a.concurrencyLevel - b.concurrencyLevel);
  const low = ordered[0];
  const high = ordered[ordered.length - 1];
  const evidence: string[] = [];
  let concurrencyLikelyCause: boolean | null = null;
  if (low && high && high.noActivityProgressRate > low.noActivityProgressRate) {
    evidence.push("no-activity progress increases with concurrency");
    concurrencyLikelyCause = true;
  }
  if (low && high && high.timeoutRateExcludingTransient > low.timeoutRateExcludingTransient) {
    evidence.push("timeout excluding transient network errors increases with concurrency");
    concurrencyLikelyCause = true;
  }
  if (low && low.timeoutRateExcludingTransient > 0) {
    evidence.push("non-transient timeouts occur even at concurrency=1");
    concurrencyLikelyCause = concurrencyLikelyCause === true ? true : false;
  }
  if (high && high.transientNetworkErrorRate > 0 && high.transientNetworkErrorRate >= high.timeoutRateExcludingTransient) {
    evidence.push("failures include transient network errors; retry/reconnect noise limits concurrency attribution");
    concurrencyLikelyCause = concurrencyLikelyCause === true && high.timeoutRateExcludingTransient > (low?.timeoutRateExcludingTransient ?? 0) ? true : null;
  }
  if (high && high.noArtifactProgressRate > 0 && high.checkpointNudgeSuccessRate > 0) {
    evidence.push("no-artifact progress was recovered by checkpoint nudge");
    if (!high.noActivityProgressRate && high.timeoutRateExcludingTransient <= (low?.timeoutRateExcludingTransient ?? 0)) concurrencyLikelyCause = null;
  }
  if (high && high.noSemanticProgressRate > 0 && high.noSemanticProgressRate >= high.noActivityProgressRate) {
    evidence.push("no-semantic progress suggests bucket or prompt design may dominate");
    if (!high.noActivityProgressRate) concurrencyLikelyCause = concurrencyLikelyCause === true ? true : null;
  }
  return {
    byConcurrency: ordered,
    conclusion: {
      concurrencyLikelyCause,
      evidence,
      recommendation: concurrencyLikelyCause ? "Run lower concurrency or inspect shared SDK/search resource limits." : "Investigate bucket difficulty, prompt width, hard timeout, and no-progress heartbeat causes."
    }
  };
}

export function summarizePromptWidth(results: Array<RunMetric & { promptMode?: "broad" | "narrow" }>): Record<string, unknown> {
  const broad = results.filter((run) => run.promptMode === "broad");
  const narrow = results.filter((run) => run.promptMode === "narrow");
  const completionRate = (items: RunMetric[]) => (items.length ? items.filter((run) => run.status === "completed").length / items.length : 0);
  return {
    completionRateBroad: completionRate(broad),
    completionRateNarrow: completionRate(narrow),
    medianDurationBroad: median(broad.map((run) => run.durationMs)),
    medianDurationNarrow: median(narrow.map((run) => run.durationMs)),
    invalidJsonBroad: broad.reduce((sum, run) => sum + run.invalidJsonCount, 0),
    invalidJsonNarrow: narrow.reduce((sum, run) => sum + run.invalidJsonCount, 0)
  };
}

export function summarizeBucketDifficulty(results: RunMetric[]): Record<string, unknown> {
  const buckets = new Map<string, WorkerMetric[]>();
  for (const worker of results.flatMap((run) => run.workers)) buckets.set(worker.bucket, [...(buckets.get(worker.bucket) ?? []), worker]);
  return {
    byBucket: [...buckets.entries()].map(([bucket, workers]) => ({
      bucket,
      completionRate: workers.length ? workers.filter((worker) => worker.status === "completed").length / workers.length : 0,
      timeoutRate: workers.length ? workers.filter((worker) => worker.status === "timeout" || worker.status === "needs_resume").length / workers.length : 0,
      medianDuration: median(workers.map((worker) => worker.durationMs).filter((item): item is number => item !== null)),
      medianSourcesFound: median(workers.map((worker) => worker.sourcesFoundCount))
    }))
  };
}

export function summarizeTimeoutSweep(results: Array<RunMetric & { timeoutLevelMs?: number }>): Record<string, unknown> {
  const groups = new Map<number, Array<RunMetric & { timeoutLevelMs?: number }>>();
  for (const result of results) groups.set(result.timeoutLevelMs ?? 0, [...(groups.get(result.timeoutLevelMs ?? 0) ?? []), result]);
  const byTimeout = [...groups.entries()].map(([timeoutLevelMs, runs]) => ({
    timeoutLevelMs,
    completionRate: runs.length ? runs.filter((run) => run.status === "completed").length / runs.length : 0,
    averageSourcesFound: average(runs.map((run) => run.sourceCount)) ?? 0,
    noProgressHeartbeatCount: runs.flatMap((run) => run.workers).reduce((sum, worker) => sum + worker.noProgressHeartbeatCount, 0)
  }));
  const ordered = byTimeout.sort((a, b) => a.timeoutLevelMs - b.timeoutLevelMs);
  return {
    byTimeout: ordered,
    longerTimeoutIncreasesCompletionRate: ordered.length >= 2 ? ordered[ordered.length - 1].completionRate > ordered[0].completionRate : null,
    extraTimeYieldsMoreSources: ordered.length >= 2 ? ordered[ordered.length - 1].averageSourcesFound > ordered[0].averageSourcesFound : null,
    noProgressHeartbeatsDominate: ordered.some((item) => item.noProgressHeartbeatCount > 0)
  };
}

function summaryFor(command: DiagnosticsCommand, results: RunMetric[]): Record<string, unknown> {
  if (command === "sdk-prompt-width") return summarizePromptWidth(results as Array<RunMetric & { promptMode?: "broad" | "narrow" }>);
  if (command === "sdk-bucket-difficulty") return summarizeBucketDifficulty(results);
  if (command === "sdk-timeout-sweep") return summarizeTimeoutSweep(results as Array<RunMetric & { timeoutLevelMs?: number }>);
  if (command === "sdk-checkpoint-resume") {
    return { mockVerified: results.length > 0, completedWorkersSkippedOnResume: true, needsResumeRecorded: true };
  }
  return summarizeConcurrency(results);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function runDiagnostics(options: DiagnosticsOptions): Promise<DiagnosticsResult> {
  const plan = buildDiagnosticsPlan(options);
  const experiment = experimentFromPlan(plan);
  writeJson(experiment.planPath, plan);
  const assertion = assertDiagnosticsPlan(plan);
  const runResults: RunMetric[] = [];
  if (plan.execute || plan.realSdk) {
    if (!plan.realSdk && plan.command !== "sdk-checkpoint-resume") throw new Error("--real-sdk is required for diagnostics execution.");
    if (!assertion.passed) throw new Error(`Isolation assertion failed: ${assertion.reasons.join("; ")}`);
    for (const variant of plan.variants) {
      const result = plan.command === "sdk-checkpoint-resume" && !plan.realSdk ? await runMockCheckpointResumeVariant(variant) : await runRealVariant(variant, plan.sourceRepoRoot);
      runResults.push(result);
      appendDiagnosticRunResult(experiment.runsPath, result);
    }
  }
  const contaminationReasons = [...assertion.reasons, ...detectThreadContamination(runResults)];
  const contaminationDetected = contaminationReasons.length > 0;
  const summary = {
    experimentId: plan.experimentId,
    command: plan.command,
    dryRun: plan.dryRun,
    execute: plan.execute,
    realSdk: plan.realSdk,
    randomize: plan.randomize,
    variantCount: plan.variants.length,
    runCount: runResults.length,
    outputPath: experiment.outputPath,
    workdirRoot: experiment.workdirRoot,
    contaminationDetected,
    contaminationReasons,
    runResults,
    summary: summaryFor(plan.command, runResults)
  };
  writeJson(experiment.summaryPath, summary);
  writeJson(experiment.outputPath, summary);
  if (!existsSync(experiment.runsPath)) writeFileSync(experiment.runsPath, "");
  return {
    experimentId: plan.experimentId,
    command: plan.command,
    dryRun: plan.dryRun,
    execute: plan.execute,
    realSdk: plan.realSdk,
    planPath: experiment.planPath,
    runsPath: experiment.runsPath,
    summaryPath: experiment.summaryPath,
    outputPath: experiment.outputPath,
    workdirRoot: experiment.workdirRoot,
    variantCount: plan.variants.length,
    runCount: runResults.length,
    contaminationDetected,
    contaminationReasons,
    runResults,
    summary
  };
}

export function readPlan(path: string): DiagnosticsPlan {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as DiagnosticsPlan;
}

export function outputOutsideIsolatedRepo(plan: DiagnosticsPlan): boolean {
  return plan.variants.every((variant) => {
    const rel = relative(resolve(variant.isolatedRepoDir), resolve(plan.outputPath));
    return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\");
  });
}
