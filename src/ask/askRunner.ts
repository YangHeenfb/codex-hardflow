import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { hardflowRunCodexHome, researchRunEvidenceLedgerPath, researchRunReportPath } from "../paths.js";
import { loadEvidenceLedger, isNoSignalEvidence, type EvidenceItem } from "../coverage/evidenceLedger.js";
import { evaluateCoverage, type CoverageEvalResult } from "../coverageEval.js";
import { prepareIsolatedCodexHome } from "../codexHomeIsolation.js";
import { runIsolatedCodexPrompt } from "../codexRunner.js";
import { runHardflowJobOnce, type RunJobOnceOptions } from "../daemon/jobRunner.js";
import { createHardflowJob, readHardflowJob } from "../jobs/jobStore.js";
import type { HardflowJob, HardflowRouterProvider, HardflowWorkerProvider } from "../jobs/jobSchema.js";
import type { RouterOutput } from "../router/routerSchema.js";
import type { CoverageMode, ParallelPolicy, ResearchReport } from "../schemas.js";
import type { SdkResearchStepRunner } from "../research/sdkResearchRunner.js";

export interface AskCoverageSummary {
  coverageMode: CoverageMode | undefined;
  parallelPolicy: ParallelPolicy | undefined;
  requiredBucketCount: number;
  completedRequiredBucketCount: number;
  searchedButNoSignalCount: number;
  excludedBucketCount: number;
  sourceCount: number;
  evidenceItemCount: number;
  coverageScore: number | null;
  coverageClaim: string | null;
}

export interface AskSourceSummary {
  id: string;
  bucket: string;
  title: string;
  urlOrRef: string;
  claim: string;
  confidence: string;
}

export interface AskResult {
  runId: string;
  status: HardflowJob["status"];
  route: HardflowJob["route"];
  async: boolean;
  answer: string;
  coverageSummary: AskCoverageSummary | null;
  sourceSummary: AskSourceSummary[];
  caveats: string[];
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
  showProgress?: boolean;
  progressWriter?: (message: string) => void;
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

function sourceSummary(items: EvidenceItem[]): AskSourceSummary[] {
  return items
    .filter((item) => !isNoSignalEvidence(item))
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      bucket: item.bucket,
      title: item.title,
      urlOrRef: item.urlOrRef,
      claim: item.claim,
      confidence: item.confidence
    }));
}

function coverageSummary(report: ResearchReport, items: EvidenceItem[], coverage: CoverageEvalResult | null): AskCoverageSummary {
  return {
    coverageMode: report.coverageMode ?? report.source_matrix?.coverageMode,
    parallelPolicy: report.parallelPolicy,
    requiredBucketCount: report.requiredBucketCount ?? report.required_buckets.length,
    completedRequiredBucketCount: report.completedRequiredBucketCount ?? coverage?.completedRequiredBucketCount ?? 0,
    searchedButNoSignalCount: report.searchedButNoSignalCount ?? report.searched_but_no_signal.length,
    excludedBucketCount: report.excludedBucketCount ?? report.excludedBuckets?.length ?? 0,
    sourceCount: report.searched_sources_table.length,
    evidenceItemCount: items.length,
    coverageScore: coverage?.coverage_score ?? null,
    coverageClaim: coverage?.coverage_claim ?? null
  };
}

function synthesizeResearchAnswer(question: string, report: ResearchReport, items: EvidenceItem[], coverage: CoverageEvalResult | null): { answer: string; caveats: string[] } {
  const supportingItems = items.filter((item) => !isNoSignalEvidence(item));
  const findings = report.useful_findings.length > 0 ? report.useful_findings.slice(0, 8) : supportingItems.map((item) => item.claim).slice(0, 8);
  const caveats = [
    ...(report.status === "degraded" ? ["Research report status is degraded."] : []),
    ...(report.failure_reason ? [`Research failure reason: ${report.failure_reason}`] : []),
    ...(report.searched_but_no_signal.length > 0 ? [`Searched but no signal: ${report.searched_but_no_signal.join(", ")}`] : []),
    ...(report.excludedBuckets?.length ? [`Excluded buckets: ${report.excludedBuckets.map((bucket) => `${bucket.bucket} (${bucket.reason})`).join(", ")}`] : []),
    ...(report.source_gaps.length > 0 ? [`Source gaps: ${report.source_gaps.join(", ")}`] : []),
    ...(supportingItems.length === 0 ? ["No source-bearing EvidenceLedger items were available; answer is limited to no-signal and coverage metadata."] : [])
  ];
  const lines = [
    `Question: ${question}`,
    "",
    "Answer from HardFlow evidence:",
    ...(findings.length > 0 ? findings.map((finding, index) => `${index + 1}. ${finding}`) : ["No useful findings were recorded in the research report."]),
    "",
    `Coverage: ${coverage?.coverage_score ?? "n/a"} score, ${report.completedRequiredBucketCount ?? 0}/${report.requiredBucketCount ?? report.required_buckets.length} required buckets completed, ${supportingItems.length} source-bearing evidence items.`
  ];
  if (supportingItems.length > 0) {
    lines.push("", "Sources:", ...supportingItems.slice(0, 8).map((item) => `- [${item.id}] ${item.title} (${item.bucket}) ${item.urlOrRef}`));
  }
  if (caveats.length > 0) {
    lines.push("", "Caveats:", ...caveats.map((caveat) => `- ${caveat}`));
  }
  return { answer: lines.join("\n"), caveats };
}

async function defaultDirectAnswer(prompt: string, cwd: string, runId: string): Promise<string> {
  const codexHome = prepareIsolatedCodexHome(hardflowRunCodexHome(cwd, runId));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    return await runIsolatedCodexPrompt(
      `Answer the user directly and concisely. Do not browse, do not claim HardFlow research ran, and do not cite external sources.\n\nUser question:\n${prompt}`,
      cwd,
      true,
      { purpose: "daemon_router", parentRunId: runId }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `HardFlow routed this as direct_answer, so strict research was not run. Direct answer generation failed locally: ${reason}`;
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
}

export function askResultFromRun(cwd: string, runId: string, questionOverride?: string): AskResult {
  const job = readHardflowJob(cwd, runId);
  if (!job) {
    return {
      runId,
      status: "failed",
      route: null,
      async: false,
      answer: `HardFlow job not found: ${runId}`,
      coverageSummary: null,
      sourceSummary: [],
      caveats: [],
      failureReason: `HardFlow job not found: ${runId}`,
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
      answer: reason,
      coverageSummary: null,
      sourceSummary: [],
      caveats: [],
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
      failureReason: `research_report.json is missing for runId=${runId}`,
      researchReportPath: researchRunReportPath(cwd, runId),
      evidenceLedgerPath: researchRunEvidenceLedgerPath(cwd, runId),
      noOrdinaryWebFallback: true
    };
  }
  const ledger = loadEvidenceLedger(cwd, runId);
  const coverage = coverageForRun(cwd, runId);
  const synthesized = synthesizeResearchAnswer(questionOverride ?? report.rawUserPrompt, report, ledger.items, coverage);
  return {
    runId,
    status: job.status,
    route: job.route,
    async: false,
    answer: synthesized.answer,
    coverageSummary: coverageSummary(report, ledger.items, coverage),
    sourceSummary: sourceSummary(ledger.items),
    caveats: synthesized.caveats,
    failureReason: null,
    researchReportPath: researchRunReportPath(cwd, runId),
    evidenceLedgerPath: researchRunEvidenceLedgerPath(cwd, runId),
    noOrdinaryWebFallback: true
  };
}

function progressLine(cwd: string, runId: string): string {
  const job = readHardflowJob(cwd, runId);
  if (!job) return `[codex-hardflow ask] runId=${runId} job=missing`;
  return `[codex-hardflow ask] runId=${runId} status=${job.status} route=${job.route ?? "pending"} queuePosition=${job.queuePosition ?? "n/a"} allocatedWorkers=${job.allocatedWorkerCount}`;
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
  if (options.fromRunId) {
    await waitForRun(options.cwd, options.fromRunId, options.timeoutMs ?? 0);
    return askResultFromRun(options.cwd, options.fromRunId, options.rawUserPrompt);
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
      failureReason: null,
      researchReportPath: null,
      evidenceLedgerPath: null,
      noOrdinaryWebFallback: true
    };
  }

  let interval: NodeJS.Timeout | undefined;
  if (options.showProgress) {
    options.progressWriter?.(progressLine(options.cwd, job.runId));
    interval = setInterval(() => options.progressWriter?.(progressLine(options.cwd, job.runId)), 5000);
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
      progress: options.showProgress
        ? (event) => options.progressWriter?.(`[codex-hardflow ask] ${event.agent}/${event.bucket}: ${event.status} - ${event.message}`)
        : undefined
    };
    const completed = await runHardflowJobOnce(options.cwd, job.runId, runOptions);
    if (completed.status !== "completed") {
      return askResultFromRun(options.cwd, completed.runId, options.rawUserPrompt);
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
        failureReason: null,
        researchReportPath: null,
        evidenceLedgerPath: null,
        noOrdinaryWebFallback: true
      };
    }
    return askResultFromRun(options.cwd, completed.runId, options.rawUserPrompt);
  } finally {
    if (interval) clearInterval(interval);
  }
}
