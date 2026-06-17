import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { hardflowRunCodexHome, researchRunEvidenceLedgerPath, researchRunReportPath } from "../paths.js";
import { loadEvidenceLedger } from "../coverage/evidenceLedger.js";
import { evaluateCoverage, type CoverageEvalResult } from "../coverageEval.js";
import { prepareIsolatedCodexHome } from "../codexHomeIsolation.js";
import { runIsolatedCodexPrompt } from "../codexRunner.js";
import { runHardflowJobOnce, type RunJobOnceOptions } from "../daemon/jobRunner.js";
import { createHardflowJob, readHardflowJob } from "../jobs/jobStore.js";
import type { HardflowJob, HardflowRouterProvider, HardflowWorkerProvider } from "../jobs/jobSchema.js";
import type { RouterOutput } from "../router/routerSchema.js";
import type { CoverageMode, ParallelPolicy, ResearchReport } from "../schemas.js";
import { listSdkWorkerStates, type SdkResearchStepRunner } from "../research/sdkResearchRunner.js";
import { languageInstruction, resolveOutputLanguagePolicy, type OutputLanguagePolicy } from "../i18n/languagePolicy.js";
import { buildCoverageSummary, labelsForLanguage, synthesizeResearchAnswer, type AskCoverageSummary, type AskSourceSummary } from "./answerSynthesis.js";
import { synthesizeAnswerBodyWithProvider, type AnswerSynthesisProvider } from "./answerSynthesisProvider.js";
import { AskProgressRenderer, type AskProgressMode, type AskProgressSnapshot } from "./progressRenderer.js";

export interface AskResult {
  runId: string;
  status: HardflowJob["status"];
  route: HardflowJob["route"];
  async: boolean;
  answer: string;
  coverageSummary: AskCoverageSummary | null;
  sourceSummary: AskSourceSummary[];
  caveats: string[];
  outputLanguagePolicy: OutputLanguagePolicy | null;
  failureReason: string | null;
  researchReportPath: string | null;
  evidenceLedgerPath: string | null;
  noOrdinaryWebFallback: true;
}

export interface RunAskOptions {
  cwd: string;
  rawUserPrompt?: string;
  runId?: string;
  fromRunId?: string;
  async?: boolean;
  timeoutMs?: number;
  coverageMode?: CoverageMode;
  parallelPolicy?: ParallelPolicy;
  routerProvider?: HardflowRouterProvider;
  workerProvider?: HardflowWorkerProvider;
  maxSourcesPerWorker?: number;
  progressMode?: AskProgressMode;
  progressIntervalMs?: number;
  progressPollIntervalMs?: number;
  progressFrameIntervalMs?: number;
  fancyProgress?: boolean;
  isProgressTty?: boolean;
  progressWriter?: (message: string) => void;
  answerSynthesisProvider?: AnswerSynthesisProvider;
  maxSourcesInAnswer?: number;
  showAllSources?: boolean;
  showEvidenceIds?: boolean;
  rawEvidenceSummary?: boolean;
  mockRouterOutput?: RouterOutput;
  sdkStepRunner?: SdkResearchStepRunner;
  sdkAvailable?: boolean;
  directAnswerRunner?: (prompt: string, cwd: string, runId: string) => Promise<string>;
}

function readResearchReportIfPresent(cwd: string, runId: string): ResearchReport | null {
  const target = researchRunReportPath(cwd, runId);
  if (!existsSync(target)) return null;
  return JSON.parse(readFileSync(target, "utf8")) as ResearchReport;
}

function mockRouterOutputForPrompt(prompt: string): RouterOutput {
  const direct = /\b(translate|rewrite|summari[sz]e)\b|翻译|改写|润色/.test(prompt.toLowerCase());
  if (direct) {
    return {
      route: "direct_answer",
      workflowPattern: "direct",
      researchProfile: "none",
      researchScope: "none",
      evidenceNeed: "none",
      localDiagnosisRequired: false,
      externalResearchRequired: false,
      exhaustiveCoverageRequired: false,
      validationProfile: "none",
      sourceBuckets: [],
      requiredAgents: [],
      requiresSourceMatrix: false,
      requiresExecutorManifest: false,
      requiresValidation: false,
      requiresFinalHoldout: false,
      requiresParallelIsolation: false,
      reasons: ["Mock router selected direct_answer."],
      risks: [],
      bypass: { requested: false, reason: "" }
    };
  }
  const buckets = ["official_docs", "github", "codex_default_discovery"] as const;
  return {
    route: "research",
    workflowPattern: "parallel_research",
    researchProfile: "broad",
    researchScope: "external_exhaustive",
    evidenceNeed: "external_sources_required",
    localDiagnosisRequired: false,
    externalResearchRequired: true,
    exhaustiveCoverageRequired: true,
    validationProfile: "none",
    sourceBuckets: buckets.map((bucket) => ({ bucket, status: "required", reason: "Mock router selected this required bucket." })),
    requiredAgents: buckets.map((bucket) => ({ name: bucket === "codex_default_discovery" ? "codex_default_researcher" : `${bucket}_researcher`, required: true, reason: "Mock router required." })),
    requiresSourceMatrix: true,
    requiresExecutorManifest: false,
    requiresValidation: false,
    requiresFinalHoldout: false,
    requiresParallelIsolation: false,
    reasons: ["Mock router selected research."],
    risks: ["may_need_current_info"],
    bypass: { requested: false, reason: "" }
  };
}

function coverageForRun(cwd: string, runId: string): CoverageEvalResult | null {
  try {
    return evaluateCoverage(cwd, { runId });
  } catch {
    return null;
  }
}

function defaultAnswerSynthesisProvider(cwd: string, runId: string, options: RunAskOptions): AnswerSynthesisProvider {
  if (options.answerSynthesisProvider) return options.answerSynthesisProvider;
  const job = readHardflowJob(cwd, runId);
  if (options.workerProvider === "mock" || options.routerProvider === "mock" || job?.workerProvider === "mock" || job?.routerProvider === "mock") {
    return "mock";
  }
  return "codex_cli";
}

function localizedJobFailureAnswer(
  status: HardflowJob["status"] | "missing",
  route: HardflowJob["route"],
  runId: string,
  reason: string,
  policy: OutputLanguagePolicy
): string {
  const labels = labelsForLanguage(policy.outputLanguage);
  if (status === "missing") return `${labels.jobNotFound}: ${runId}`;
  if (route === "router_failed" || /^router\b/i.test(reason) || /router output failed/i.test(reason)) {
    return `${labels.routingFailed}: HardFlow could not produce a valid router_trace for runId=${runId}.\n${labels.details}: ${reason}`;
  }
  if (status === "failed" || status === "cancelled") return `${labels.failed}: ${reason}`;
  return `${labels.jobNotComplete}: runId=${runId}, status=${status}.\n${labels.details}: ${reason}`;
}

async function defaultDirectAnswer(prompt: string, cwd: string, runId: string): Promise<string> {
  const codexHome = prepareIsolatedCodexHome(hardflowRunCodexHome(cwd, runId));
  const previous = process.env.CODEX_HOME;
  const policy = resolveOutputLanguagePolicy(prompt);
  process.env.CODEX_HOME = codexHome;
  try {
    return await runIsolatedCodexPrompt(
      `Answer the user directly and concisely. ${languageInstruction(policy)} Do not browse, do not claim HardFlow research ran, and do not cite external sources.\n\nUser question:\n${prompt}`,
      cwd,
      true,
      { purpose: "daemon_router", parentRunId: runId }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const labels = labelsForLanguage(policy.outputLanguage);
    return `${labels.runInfo}: HardFlow route=direct_answer; strict research was not run. ${labels.failed}: ${reason}`;
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
}

export function askResultFromRun(
  cwd: string,
  runId: string,
  questionOverride?: string,
  synthesisOptions: { maxSourcesInAnswer?: number; showAllSources?: boolean; showEvidenceIds?: boolean; rawEvidenceSummary?: boolean } = {}
): AskResult {
  const job = readHardflowJob(cwd, runId);
  const fallbackPolicy = resolveOutputLanguagePolicy(questionOverride ?? job?.rawUserPrompt ?? "");
  if (!job) {
    const reason = `HardFlow job not found: ${runId}`;
    return {
      runId,
      status: "failed",
      route: null,
      async: false,
      answer: localizedJobFailureAnswer("missing", null, runId, reason, fallbackPolicy),
      coverageSummary: null,
      sourceSummary: [],
      caveats: [],
      outputLanguagePolicy: fallbackPolicy,
      failureReason: reason,
      researchReportPath: null,
      evidenceLedgerPath: null,
      noOrdinaryWebFallback: true
    };
  }
  if (job.status !== "completed") {
    const reason =
      job.status === "failed" || job.status === "cancelled"
        ? (job.failureReason ?? `HardFlow job ${job.status}`)
        : `HardFlow job is not complete: status=${job.status}, queuePosition=${job.queuePosition ?? "n/a"}`;
    return {
      runId,
      status: job.status,
      route: job.route,
      async: false,
      answer: localizedJobFailureAnswer(job.status, job.route, runId, reason, fallbackPolicy),
      coverageSummary: null,
      sourceSummary: [],
      caveats: [],
      outputLanguagePolicy: fallbackPolicy,
      failureReason: reason,
      researchReportPath: job.researchReportPath,
      evidenceLedgerPath: job.evidenceLedgerPath,
      noOrdinaryWebFallback: true
    };
  }
  if (job.route !== "research") {
    return {
      runId,
      status: job.status,
      route: job.route,
      async: false,
      answer: `HardFlow route=${job.route ?? "unknown"} completed without strict research. No EvidenceLedger answer synthesis was required.`,
      coverageSummary: null,
      sourceSummary: [],
      caveats: [],
      outputLanguagePolicy: fallbackPolicy,
      failureReason: null,
      researchReportPath: job.researchReportPath,
      evidenceLedgerPath: job.evidenceLedgerPath,
      noOrdinaryWebFallback: true
    };
  }
  const report = readResearchReportIfPresent(cwd, runId);
  if (!report) {
    return {
      runId,
      status: "failed",
      route: "research",
      async: false,
      answer: `research_report.json is missing for runId=${runId}`,
      coverageSummary: null,
      sourceSummary: [],
      caveats: [],
      outputLanguagePolicy: fallbackPolicy,
      failureReason: `research_report.json is missing for runId=${runId}`,
      researchReportPath: researchRunReportPath(cwd, runId),
      evidenceLedgerPath: researchRunEvidenceLedgerPath(cwd, runId),
      noOrdinaryWebFallback: true
    };
  }
  const ledger = loadEvidenceLedger(cwd, runId);
  const coverage = coverageForRun(cwd, runId);
  const synthesized = synthesizeResearchAnswer(questionOverride ?? report.rawUserPrompt, report, ledger.items, coverage, {
    ...synthesisOptions,
    fullReportPath: researchRunReportPath(cwd, runId)
  });
  return {
    runId,
    status: job.status,
    route: job.route,
    async: false,
    answer: synthesized.answer,
    coverageSummary: synthesized.coverageSummary,
    sourceSummary: synthesized.sourceSummary,
    caveats: synthesized.caveats,
    outputLanguagePolicy: synthesized.outputLanguagePolicy,
    failureReason: null,
    researchReportPath: researchRunReportPath(cwd, runId),
    evidenceLedgerPath: researchRunEvidenceLedgerPath(cwd, runId),
    noOrdinaryWebFallback: true
  };
}

async function askResultFromRunWithSynthesis(
  cwd: string,
  runId: string,
  questionOverride: string | undefined,
  synthesisOptions: { maxSourcesInAnswer?: number; showAllSources?: boolean; showEvidenceIds?: boolean; rawEvidenceSummary?: boolean },
  provider: AnswerSynthesisProvider,
  timeoutMs?: number
): Promise<AskResult> {
  const job = readHardflowJob(cwd, runId);
  if (!job || job.status !== "completed" || job.route !== "research") {
    return askResultFromRun(cwd, runId, questionOverride, synthesisOptions);
  }
  const report = readResearchReportIfPresent(cwd, runId);
  if (!report) return askResultFromRun(cwd, runId, questionOverride, synthesisOptions);
  const ledger = loadEvidenceLedger(cwd, runId);
  const coverage = coverageForRun(cwd, runId);
  const question = questionOverride ?? report.rawUserPrompt;
  const policy = resolveOutputLanguagePolicy(question);
  const coverageSummary = buildCoverageSummary(report, ledger.items, coverage);
  const providerResult = await synthesizeAnswerBodyWithProvider({
    cwd,
    runId,
    rawUserPrompt: question,
    report,
    items: ledger.items,
    coverage,
    coverageSummary,
    languagePolicy: policy,
    provider,
    timeoutMs
  });
  const synthesized = synthesizeResearchAnswer(question, report, ledger.items, coverage, {
    ...synthesisOptions,
    answerBody: providerResult.answerBody,
    synthesisWarning: providerResult.warning,
    fullReportPath: researchRunReportPath(cwd, runId)
  });
  return {
    runId,
    status: job.status,
    route: job.route,
    async: false,
    answer: synthesized.answer,
    coverageSummary: synthesized.coverageSummary,
    sourceSummary: synthesized.sourceSummary,
    caveats: synthesized.caveats,
    outputLanguagePolicy: synthesized.outputLanguagePolicy,
    failureReason: null,
    researchReportPath: researchRunReportPath(cwd, runId),
    evidenceLedgerPath: researchRunEvidenceLedgerPath(cwd, runId),
    noOrdinaryWebFallback: true
  };
}

function progressSnapshot(cwd: string, runId: string, startedAt: number, message?: string): AskProgressSnapshot {
  const job = readHardflowJob(cwd, runId);
  const workers = listSdkWorkerStates(cwd, runId);
  const completed = workers.filter((worker) => worker.status === "completed").length;
  const running = workers.filter((worker) => worker.status === "running").length;
  const failed = workers.filter((worker) => worker.status === "failed" || worker.status === "timeout" || worker.status === "needs_resume").length;
  const retrying = 0;
  const coverage = coverageForRun(cwd, runId);
  const slowest = workers
    .filter((worker) => worker.status === "running")
    .sort((a, b) => b.durationMs - a.durationMs)[0];
  return {
    runId,
    status: job?.status ?? "missing",
    route: job?.route,
    requiredBucketCount: job?.requestedWorkerCount || workers.length || undefined,
    completedBucketCount: completed,
    runningBucketCount: running,
    failedBucketCount: failed,
    retryingBucketCount: retrying,
    coverageScoreSoFar: coverage?.coverage_score ?? null,
    activeWorkerCount: job?.allocatedWorkerCount,
    elapsedMs: Date.now() - startedAt,
    message,
    slowestWorker: slowest?.bucket ?? null
  };
}

async function waitForRun(cwd: string, runId: string, timeoutMs = 0): Promise<HardflowJob | null> {
  const started = Date.now();
  while (true) {
    const job = readHardflowJob(cwd, runId);
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
    if (timeoutMs > 0 && Date.now() - started >= timeoutMs) return job;
    await delay(1000);
  }
}

export async function runAsk(options: RunAskOptions): Promise<AskResult> {
  const synthesisOptions = {
    maxSourcesInAnswer: options.maxSourcesInAnswer,
    showAllSources: options.showAllSources,
    showEvidenceIds: options.showEvidenceIds,
    rawEvidenceSummary: options.rawEvidenceSummary
  };
  if (options.fromRunId) {
    await waitForRun(options.cwd, options.fromRunId, options.timeoutMs ?? 0);
    const provider = defaultAnswerSynthesisProvider(options.cwd, options.fromRunId, options);
    return askResultFromRunWithSynthesis(options.cwd, options.fromRunId, options.rawUserPrompt, synthesisOptions, provider, options.timeoutMs);
  }
  if (!options.rawUserPrompt?.trim()) throw new Error("codex-hardflow ask requires a question.");
  const runId = options.runId ?? `run-ask-${randomUUID()}`;
  const job = createHardflowJob({
    runId,
    cwd: options.cwd,
    rawUserPrompt: options.rawUserPrompt,
    promptHash: "",
    turnId: runId,
    triggerSource: "cli",
    routerProvider: options.routerProvider,
    workerProvider: options.workerProvider,
    coverageMode: options.coverageMode,
    parallelPolicy: options.parallelPolicy,
    foreground: options.async ? false : true,
    currentUserTurn: options.async ? false : true,
    priority: options.async ? "normal" : "high"
  });
  if (options.async) {
    return {
      runId: job.runId,
      status: job.status,
      route: job.route,
      async: true,
      answer: `HardFlow job queued. runId=${job.runId}`,
      coverageSummary: null,
      sourceSummary: [],
      caveats: [],
      outputLanguagePolicy: resolveOutputLanguagePolicy(options.rawUserPrompt),
      failureReason: null,
      researchReportPath: null,
      evidenceLedgerPath: null,
      noOrdinaryWebFallback: true
    };
  }

  const startedAt = Date.now();
  const progressMode = options.progressMode ?? "auto";
  const renderer = new AskProgressRenderer({
    mode: progressMode,
    isTty: options.isProgressTty,
    intervalMs: options.progressIntervalMs,
    frameIntervalMs: options.progressFrameIntervalMs,
    fancy: options.fancyProgress,
    write: options.progressWriter ?? (() => undefined)
  });
  let pollInterval: NodeJS.Timeout | undefined;
  let frameInterval: NodeJS.Timeout | undefined;
  let latestSnapshot: AskProgressSnapshot | undefined;
  const refreshSnapshot = (message?: string, event?: string, overrides: Partial<AskProgressSnapshot> = {}): AskProgressSnapshot => {
    latestSnapshot = {
      ...progressSnapshot(options.cwd, job.runId, startedAt, message),
      ...(event ? { event } : {}),
      ...overrides
    };
    return latestSnapshot;
  };
  if (progressMode !== "quiet") {
    latestSnapshot = refreshSnapshot(undefined, "started");
    renderer.render(latestSnapshot, true);
    pollInterval = setInterval(() => renderer.render(refreshSnapshot()), options.progressPollIntervalMs ?? 1000);
    if (renderer.usesDynamicTty()) {
      frameInterval = setInterval(() => {
        if (!latestSnapshot) return;
        renderer.render({ ...latestSnapshot, elapsedMs: Date.now() - startedAt });
      }, options.progressFrameIntervalMs ?? 150);
    }
  }
  try {
    const runOptions: RunJobOnceOptions = {
      routerTimeoutMs: options.timeoutMs,
      mockRouterOutput: options.mockRouterOutput ?? (options.routerProvider === "mock" ? mockRouterOutputForPrompt(options.rawUserPrompt) : undefined),
      sdkStepRunner: options.sdkStepRunner,
      sdkAvailable: options.sdkAvailable,
      globalBudgetMs: options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined,
      hardTimeoutMs: options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined,
      maxSourcesPerWorker: options.maxSourcesPerWorker,
      progress:
        progressMode !== "quiet"
          ? (event) =>
              renderer.render(
                refreshSnapshot(`${event.agent}/${event.bucket}: ${event.status} - ${event.message}`, event.status),
                true
              )
          : undefined
    };
    const completed = await runHardflowJobOnce(options.cwd, job.runId, runOptions);
    if (completed.status !== "completed") {
      return askResultFromRun(options.cwd, completed.runId, options.rawUserPrompt, synthesisOptions);
    }
    if (completed.route === "direct_answer" || completed.route === "bypass") {
      const answer = await (options.directAnswerRunner ?? defaultDirectAnswer)(options.rawUserPrompt, options.cwd, completed.runId);
      return {
        runId: completed.runId,
        status: completed.status,
        route: completed.route,
        async: false,
        answer,
        coverageSummary: null,
        sourceSummary: [],
        caveats: [],
        outputLanguagePolicy: resolveOutputLanguagePolicy(options.rawUserPrompt),
        failureReason: null,
        researchReportPath: null,
        evidenceLedgerPath: null,
        noOrdinaryWebFallback: true
      };
    }
    renderer.render(refreshSnapshot(undefined, "synthesizing", { status: "synthesizing" }), true);
    const provider = defaultAnswerSynthesisProvider(options.cwd, completed.runId, options);
    const result = await askResultFromRunWithSynthesis(options.cwd, completed.runId, options.rawUserPrompt, synthesisOptions, provider, options.timeoutMs);
    renderer.render(refreshSnapshot(undefined, "completed"), true);
    return result;
  } finally {
    if (pollInterval) clearInterval(pollInterval);
    if (frameInterval) clearInterval(frameInterval);
    renderer.finish();
  }
}
