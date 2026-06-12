import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { codexRunnerStatus, runIsolatedCodexPrompt } from "./codexRunner.js";
import { buildCoveragePlan, maybeLoadCoveragePlan, writeCoveragePlan, type CoveragePlan } from "./coverage/coveragePlan.js";
import { addEvidence, perspectiveForBucket, researchQuestionForBucket } from "./coverage/evidenceLedger.js";
import { appendHookEvent } from "./hookEvents.js";
import {
  cancelSdkWorker,
  listSdkWorkerStates,
  runSdkResearchPool,
  type SdkResearchStepRunner,
  type SdkResearchPoolResult,
  DEFAULT_SDK_GLOBAL_BUDGET_MS,
  DEFAULT_SDK_HARD_TIMEOUT_MS,
  DEFAULT_SDK_HEARTBEAT_INTERVAL_MS,
  DEFAULT_SDK_MAX_CONCURRENT_BUCKETS,
  DEFAULT_SDK_MAX_NO_PROGRESS_HEARTBEATS,
  DEFAULT_SDK_SOFT_TIMEOUT_MS,
  DEFAULT_SDK_WORKER_LEASE_MS
} from "./research/sdkResearchRunner.js";
import { buildSourceCoverageMatrix, applyDefaultDiscoveryFindings } from "./sourceMatrix.js";
import { runLlmRouter } from "./router/llmRouter.js";
import { routerFailedOutput } from "./router/routerFallback.js";
import type { RouterOutput, RouterTrace } from "./router/routerSchema.js";
import { buildRouterTrace, writeRouterTrace } from "./router/routerTrace.js";
import type {
  CodexDefaultDiscoveryStatus,
  ResearchAgentRun,
  ResearchAgentRunStatus,
  ResearchBucketStatus,
  ResearchReport,
  ResearchReportOwner,
  ResearcherReport,
  ResearchRunnerMode,
  SdkWorkerPoolStatus,
  SdkWorkerRun,
  SubagentStatus,
  SubagentTriggerSource,
  ResearchSource,
  SubagentReport,
  SubagentReportStatus,
  SourceCoverageMatrix,
  TriggerSource,
  CoverageMode,
  ParallelPolicy
} from "./schemas.js";
import { currentResearchReportPath, researchRunMetadataPath, researchRunReportPath, researchRunRouterTracePath, researchRunSubagentsDir, researchSubagentReportPath } from "./paths.js";
import { createHookMarker, hashText, resolveLatestActiveMarker } from "./hookState.js";

export interface BuildResearchReportOptions {
  rawUserPrompt?: string;
  normalizedTask?: string;
  turnId?: string;
  taskType?: string;
  runId?: string;
  parentRunId?: string;
  owner?: ResearchReportOwner;
  parentTaskPromptHash?: string;
  subagentName?: string;
  bucket?: string;
  mergedSubagentReports?: string[];
  currentPointerUpdatedAt?: string;
  routerOutput?: RouterOutput;
  routerTraceReused?: boolean;
  routerTracePath?: string;
  routerTraceReuseReason?: string;
  routerTraceStaleReason?: string;
  runnerMode?: ResearchRunnerMode;
  evidenceMode?: ResearchReport["evidence_mode"];
  manualFallbackReason?: string;
  failureReason?: string;
  subagentStatus?: ResearchReport["subagent_status"];
  subagentTriggerSource?: ResearchReport["subagent_trigger_source"];
  subagentSkipReason?: string;
  triggerSource?: TriggerSource;
  programmaticTrigger?: boolean;
  programmaticMultiAgent?: boolean;
  strictProgrammatic?: boolean;
  appHandoffRequired?: boolean;
  sdkThreadsStarted?: boolean;
  sdkThreadsAllowed?: boolean;
  subagentInstructionInjected?: boolean;
  manualBackfillRequired?: boolean;
  generatedAt?: string;
  agentRuns?: ResearchAgentRun[];
  bucketStatuses?: Record<string, ResearchBucketStatus>;
  researcherReports?: ResearcherReport[];
  sdkWorkerStatus?: SdkWorkerPoolStatus;
  sdkWorkerRuns?: SdkWorkerRun[];
  appSubagentStatus?: ResearchReport["app_subagent_status"];
  coverageMode?: CoverageMode;
  parallelPolicy?: ParallelPolicy;
}

export interface RunResearchOptions extends BuildResearchReportOptions {
  sourceRoot?: string;
  input?: Record<string, unknown>;
  executeSdkResearch?: boolean;
  runRouter?: boolean;
  strictProgrammatic?: boolean;
  sdkAvailable?: boolean;
  routerPromptRunner?: (prompt: string, cwd: string) => Promise<string>;
  routerTimeoutMs?: number;
  sdkTimeoutMs?: number;
  perBucketTimeoutMs?: number;
  maxConcurrentBuckets?: number;
  workerLeaseMs?: number;
  softTimeoutMs?: number;
  hardTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  maxNoProgressHeartbeats?: number;
  maxSourcesPerWorker?: number;
  maxRetriesPerWorker?: number;
  retryInitialBackoffMs?: number;
  retryMaxBackoffMs?: number;
  retryJitter?: boolean;
  maxNoArtifactProgressIntervals?: number;
  maxNoSemanticProgressIntervals?: number;
  checkpointNudgeTimeoutMs?: number;
  maxCheckpointNudges?: number;
  globalBudgetMs?: number;
  coverageMode?: CoverageMode;
  parallelPolicy?: ParallelPolicy;
  sdkPromptRunner?: (prompt: string, cwd: string, bucket: string) => Promise<string>;
  sdkStepRunner?: SdkResearchStepRunner;
  defaultDiscoveryBuckets?: string[];
  progress?: (event: ResearchProgressEvent) => void;
}

export interface ResearchProgressEvent {
  bucket: string;
  agent: string;
  status: "started" | ResearchAgentRunStatus;
  message: string;
}

export interface AddSubagentReportInput {
  runId?: string;
  parentRunId?: string;
  agent: string;
  bucket: string;
  status: SubagentReportStatus;
  sources_found?: ResearchSource[];
  searched_but_no_signal?: boolean;
  queries_run?: string[];
  failure_reason?: string;
  startedAt?: string;
  endedAt?: string;
}

const DEFAULT_MANUAL_FALLBACK_REASON = "No live subagent or SDK researcher runner was configured for this local report builder.";
const DEFAULT_APP_HANDOFF_REASON = "App handoff report initialized; spawn App subagents or backfill manual sources with codex-hardflow report commands.";
const DEFAULT_PER_BUCKET_TIMEOUT_MS = 180_000;
const DEFAULT_GLOBAL_BUDGET_MS = 600_000;
const DEFAULT_MAX_CONCURRENT_BUCKETS = 3;

function agentForBucket(bucket: string): string {
  const map: Record<string, string> = {
    official_docs: "official_docs_researcher",
    github: "github_researcher",
    community: "community_researcher",
    academic: "academic_researcher",
    package_registry: "package_security_researcher",
    security: "package_security_researcher",
    blogs_engineering: "community_researcher",
    competitors: "competitor_researcher",
    local_repo: "local_repo_researcher",
    codex_default_discovery: "codex_default_researcher"
  };
  return map[bucket] ?? "codex_default_researcher";
}

function reportForEntry(entry: SourceCoverageMatrix["entries"][number], searchedButNoSignal: boolean): ResearcherReport {
  return {
    bucket: String(entry.bucket),
    queries_run: entry.required ? entry.querySeeds : [],
    sources_found: [],
    searched_but_no_signal: searchedButNoSignal,
    uncertainties: entry.required ? ["No live source signal was recorded for this bucket. See agent_runs for runner status."] : [],
    recommended_followups: entry.required ? [`Run ${entry.bucket} researcher with the query seeds recorded in the source matrix.`] : []
  };
}

function manualAgentRun(entry: SourceCoverageMatrix["entries"][number], reason: string, generatedAt: string): ResearchAgentRun {
  return {
    agent: agentForBucket(String(entry.bucket)),
    bucket: String(entry.bucket),
    status: "manual_fallback",
    startedAt: generatedAt,
    endedAt: generatedAt,
    queries_run: entry.querySeeds,
    sources_found_count: 0,
    searched_but_no_signal: false,
    failure_reason: reason,
    fallback_used: true
  };
}

function bucketStatusFromRun(run: ResearchAgentRun): ResearchBucketStatus {
  if (run.status === "completed") return run.searched_but_no_signal ? "searched_but_no_signal" : "completed";
  if (run.status === "timeout") return "timeout";
  if (run.status === "context_exhausted") return "context_exhausted";
  if (run.status === "manual_fallback") return "manual_fallback";
  return "failed";
}

function codexDefaultStatusFromRun(run: ResearchAgentRun | undefined, fallback: CodexDefaultDiscoveryStatus): CodexDefaultDiscoveryStatus {
  if (fallback !== "not_configured") return fallback;
  if (!run) return fallback;
  if (run.status === "completed") return "completed";
  if (run.status === "timeout") return "timeout";
  if (run.status === "manual_fallback") return "not_configured";
  return "failed";
}

function normalizeBucketStatuses(requiredBuckets: string[], statuses: Record<string, ResearchBucketStatus>): Record<string, ResearchBucketStatus> {
  const next = { ...statuses };
  if ((requiredBuckets.includes("package_registry") || requiredBuckets.includes("security")) && !next.package_security) {
    next.package_security = next.security ?? next.package_registry ?? "manual_fallback";
  }
  return next;
}

function taskParts(task: string, options: Pick<BuildResearchReportOptions, "rawUserPrompt" | "normalizedTask">): { rawUserPrompt: string; normalizedTask: string; classificationInput: string } {
  const rawUserPrompt = options.rawUserPrompt ?? task;
  const normalizedTask = options.normalizedTask ?? task;
  const classificationInput = rawUserPrompt === normalizedTask ? rawUserPrompt : `${rawUserPrompt}\n\nNormalized task:\n${normalizedTask}`;
  return { rawUserPrompt, normalizedTask, classificationInput };
}

function sourceMatrixForTask(task: string, options: BuildResearchReportOptions): SourceCoverageMatrix {
  const parts = taskParts(task, options);
  const matrix = buildSourceCoverageMatrix(parts.classificationInput, {
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    classificationInput: parts.classificationInput,
    runId: options.runId,
    routerOutput: options.routerOutput,
    coverageMode: options.coverageMode
  });
  return {
    ...matrix,
    task: parts.rawUserPrompt,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    classificationInput: parts.classificationInput
  };
}

interface ExistingRouterTraceResolution {
  output?: RouterOutput;
  path: string;
  reused: boolean;
  reuseReason?: string;
  staleReason?: string;
}

function matchingRouterTrace(trace: RouterTrace, parts: ReturnType<typeof taskParts>): boolean {
  const expectedPromptHash = hashText(parts.rawUserPrompt);
  if (trace.promptHash === expectedPromptHash) return true;
  if (trace.rawUserPrompt.trim() === parts.rawUserPrompt.trim()) return true;
  if ((trace.normalizedTask ?? "").trim() && trace.normalizedTask?.trim() === parts.normalizedTask.trim()) return true;
  return false;
}

function resolveExistingParentRouterTrace(cwd: string, runId: string, parts: ReturnType<typeof taskParts>): ExistingRouterTraceResolution {
  const path = researchRunRouterTracePath(cwd, runId);
  if (!existsSync(path)) {
    return { path, reused: false, staleReason: "No run-owned router_trace exists for this runId." };
  }
  let trace: RouterTrace;
  try {
    trace = JSON.parse(readFileSync(path, "utf8")) as RouterTrace;
  } catch {
    return { path, reused: false, staleReason: "Existing router_trace is not valid JSON." };
  }
  if ((trace.owner ?? "parent") === "subagent") {
    return { path, reused: false, staleReason: "Existing router_trace is subagent-owned and cannot satisfy parent research." };
  }
  if (trace.runId !== runId) {
    return { path, reused: false, staleReason: `Existing router_trace runId=${trace.runId ?? "missing"} does not match ${runId}.` };
  }
  if (!matchingRouterTrace(trace, parts)) {
    return { path, reused: false, staleReason: "Existing router_trace promptHash/raw prompt/normalizedTask does not match this research task." };
  }
  if (!trace.routerOutput || trace.routerOutput.route === "router_failed") {
    return { path, reused: false, staleReason: "Existing router_trace has no valid routerOutput to reuse." };
  }
  return {
    output: trace.routerOutput,
    path,
    reused: true,
    reuseReason: "Reused existing run-owned parent router_trace for this runId."
  };
}

function reportStatus(bucketStatuses: Record<string, ResearchBucketStatus>, searchedSources: ResearchSource[]): ResearchReport["status"] {
  const statuses = Object.values(bucketStatuses);
  if (statuses.length > 0 && statuses.every((status) => status === "timeout" || status === "failed" || status === "context_exhausted" || status === "manual_fallback")) {
    return "failed";
  }
  if (searchedSources.length === 0 || statuses.some((status) => status === "timeout" || status === "failed" || status === "context_exhausted" || status === "manual_fallback")) {
    return "degraded";
  }
  return "completed";
}

function reportStatusForRunner(runnerMode: ResearchRunnerMode, bucketStatuses: Record<string, ResearchBucketStatus>, searchedSources: ResearchSource[]): ResearchReport["status"] {
  if (runnerMode === "app_handoff" && searchedSources.length === 0) return "degraded";
  return reportStatus(bucketStatuses, searchedSources);
}

function manualBackfillRequiredFor(runnerMode: ResearchRunnerMode, status: ResearchReport["status"], searchedSources: ResearchSource[]): boolean {
  if (runnerMode === "app_handoff" || runnerMode === "manual_fallback") return true;
  if (runnerMode === "sdk_threads" || runnerMode === "strict_programmatic") return status !== "completed" || searchedSources.length === 0;
  return false;
}

function defaultSubagentStatus(runnerMode: ResearchRunnerMode, options: BuildResearchReportOptions): SubagentStatus {
  if (options.subagentStatus) return options.subagentStatus;
  if (runnerMode === "sdk_threads" || runnerMode === "strict_programmatic") return "not_applicable";
  if (runnerMode === "app_handoff") return "not_spawned";
  return "not_applicable";
}

function defaultSubagentTriggerSource(runnerMode: ResearchRunnerMode, status: SubagentStatus, options: BuildResearchReportOptions): SubagentTriggerSource {
  if (options.subagentTriggerSource) return options.subagentTriggerSource;
  if (runnerMode === "sdk_threads" || runnerMode === "strict_programmatic") return "sdk_threads";
  if (status === "spawned") return "app_tool";
  if (runnerMode === "manual_fallback" || runnerMode === "mixed") return "manual";
  return "none";
}

function defaultEvidenceMode(runnerMode: ResearchRunnerMode, searchedSources: ResearchSource[], agentRuns: ResearchAgentRun[]): ResearchReport["evidence_mode"] {
  if (searchedSources.length === 0 && agentRuns.length === 0) return "none";
  if (runnerMode === "app_handoff") return searchedSources.length > 0 ? "app_handoff" : "none";
  if (runnerMode === "manual_fallback") return searchedSources.length > 0 ? "manual_backfilled" : "none";
  if (runnerMode === "sdk_threads" || runnerMode === "strict_programmatic") return "sdk_threads";
  return "mixed";
}

function hasProgrammaticWorkerRuns(agentRuns: ResearchAgentRun[], mergedSubagentReports: string[] = []): boolean {
  return agentRuns.some((run) => !run.fallback_used && run.status !== "manual_fallback") || mergedSubagentReports.length > 0;
}

function completedRequiredStatus(status: ResearchBucketStatus | undefined): boolean {
  return status === "completed" || status === "manual_backfilled" || status === "searched_but_no_signal";
}

export function buildResearchReport(
  task: string,
  defaultDiscoveryBuckets: string[] = [],
  codexDefaultDiscoveryStatus: CodexDefaultDiscoveryStatus = "not_configured",
  options: BuildResearchReportOptions = {}
): ResearchReport {
  const parts = taskParts(task, options);
  const promptHash = hashText(parts.rawUserPrompt);
  let matrix = sourceMatrixForTask(task, options);
  if (defaultDiscoveryBuckets.length > 0) {
    matrix = applyDefaultDiscoveryFindings(matrix, defaultDiscoveryBuckets);
  }
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const requiredEntries = matrix.entries.filter((entry) => entry.required);
  const requiredBuckets = requiredEntries.map((entry) => String(entry.bucket));
  const runnerMode = options.runnerMode ?? "manual_fallback";
  const manualFallbackReason = options.manualFallbackReason ?? DEFAULT_MANUAL_FALLBACK_REASON;
  const agentRuns =
    options.agentRuns ??
    requiredEntries.map((entry) => manualAgentRun(entry, manualFallbackReason, generatedAt));
  const baseStatuses = Object.fromEntries(agentRuns.map((run) => [run.bucket, bucketStatusFromRun(run)]));
  const bucketStatuses = normalizeBucketStatuses(requiredBuckets, options.bucketStatuses ?? baseStatuses);
  const researcherReports =
    options.researcherReports ??
    requiredEntries.map((entry) => reportForEntry(entry, bucketStatuses[String(entry.bucket)] === "searched_but_no_signal"));
  const codexRun = agentRuns.find((run) => run.bucket === "codex_default_discovery");
  const searchedSources = researcherReports.flatMap((report) => report.sources_found);
  const status = reportStatusForRunner(runnerMode, bucketStatuses, searchedSources);
  const runId = options.runId ?? options.turnId ?? `run-${promptHash}-${hashText(generatedAt)}`;
  const subagentStatus = defaultSubagentStatus(runnerMode, options);
  const subagentTriggerSource = defaultSubagentTriggerSource(runnerMode, subagentStatus, options);
  const mergedSubagentReports = options.mergedSubagentReports ?? [];
  const evidenceMode = options.evidenceMode ?? defaultEvidenceMode(runnerMode, searchedSources, agentRuns);
  const programmaticMultiAgent = options.programmaticMultiAgent ?? hasProgrammaticWorkerRuns(agentRuns, mergedSubagentReports);

  return {
    runId,
    parentRunId: options.parentRunId,
    owner: options.owner ?? "parent",
    parentTaskPromptHash: options.parentTaskPromptHash ?? promptHash,
    subagentName: options.subagentName,
    bucket: options.bucket,
    mergedSubagentReports,
    currentPointerUpdatedAt: options.currentPointerUpdatedAt,
    task,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    classificationInput: parts.classificationInput,
    promptHash,
    turnId: options.turnId ?? `research-${hashText(task)}`,
    generatedAt,
    taskType: options.taskType ?? "research-heavy",
    triggerSource: options.triggerSource ?? "unknown",
    programmaticTrigger: options.programmaticTrigger ?? false,
    programmaticMultiAgent,
    status,
    runner_mode: runnerMode,
    evidence_mode: evidenceMode,
    failure_reason: options.failureReason,
    strict_programmatic: options.strictProgrammatic,
    sdk_worker_status: options.sdkWorkerStatus,
    sdk_worker_runs: options.sdkWorkerRuns,
    app_subagent_status: options.appSubagentStatus ?? (runnerMode === "sdk_threads" || runnerMode === "strict_programmatic" ? "not_applicable" : runnerMode === "app_handoff" ? "not_spawned" : undefined),
    app_handoff_required: options.appHandoffRequired ?? runnerMode === "app_handoff",
    sdk_threads_started: options.sdkThreadsStarted ?? (runnerMode === "sdk_threads" || runnerMode === "strict_programmatic"),
    sdk_threads_allowed: options.sdkThreadsAllowed ?? (runnerMode === "sdk_threads" || runnerMode === "strict_programmatic"),
    subagent_instruction_injected: options.subagentInstructionInjected ?? runnerMode === "app_handoff",
    manual_backfill_required: options.manualBackfillRequired ?? manualBackfillRequiredFor(runnerMode, status, searchedSources),
    manual_fallback_reason: runnerMode === "manual_fallback" || runnerMode === "mixed" ? manualFallbackReason : undefined,
    subagent_status: subagentStatus,
    subagent_trigger_source: subagentTriggerSource,
    subagent_skip_reason: options.subagentSkipReason ?? (subagentStatus === "not_spawned" ? "Subagents were not spawned; manual/App backfill is required." : undefined),
    router_trace_reused: options.routerTraceReused ?? false,
    router_trace_path: options.routerTracePath,
    router_trace_reuse_reason: options.routerTraceReuseReason,
    router_trace_stale_reason: options.routerTraceStaleReason,
    source_matrix: matrix,
    coverageMode: matrix.coverageMode,
    parallelPolicy: options.parallelPolicy,
    required_buckets: requiredBuckets,
    requiredBucketCount: requiredBuckets.length,
    completedRequiredBucketCount: requiredBuckets.filter((bucket) => completedRequiredStatus(bucketStatuses[bucket])).length,
    searchedButNoSignalCount: requiredBuckets.filter((bucket) => bucketStatuses[bucket] === "searched_but_no_signal").length,
    excludedBucketCount: matrix.excludedBuckets?.length ?? 0,
    excludedBuckets: matrix.excludedBuckets ?? [],
    skippedPossibleBuckets: matrix.skippedPossibleBuckets ?? [],
    coverageDebt: matrix.coverageDebt ?? [],
    bucket_statuses: bucketStatuses,
    agent_runs: agentRuns,
    researcher_reports: researcherReports,
    searched_sources_table: searchedSources,
    searched_but_no_signal: requiredBuckets.filter((bucket) => bucketStatuses[bucket] === "searched_but_no_signal"),
    codex_default_discovery_status: codexDefaultStatusFromRun(codexRun, codexDefaultDiscoveryStatus),
    codex_default_discovery_findings: {
      unexpected_source_buckets: defaultDiscoveryBuckets,
      followup_recommendations: defaultDiscoveryBuckets.map((bucket) => `Run follow-up search for ${bucket}.`)
    },
    useful_findings: [],
    conflicting_findings: [],
    source_gaps: requiredBuckets.filter((bucket) => !completedRequiredStatus(bucketStatuses[bucket])),
    confidence_summary:
      runnerMode === "app_handoff"
        ? "App handoff initialized; final confidence depends on backfilled App/manual/subagent evidence."
        : runnerMode === "manual_fallback"
          ? "Manual fallback report; no live runner completed."
          : "Research runner completed with recorded bucket statuses.",
    citations_or_refs: [],
    prompt_injection_notes: [matrix.promptInjectionCaution]
  };
}

function extractJsonObject(raw: string): unknown | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asSources(value: unknown): ResearchSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ResearchSource => typeof item === "object" && item !== null && "title" in item && "source_type" in item);
}

function parsedResearcherReport(raw: string, bucket: string): ResearcherReport | null {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const object = parsed as Record<string, unknown>;
  const sources = asSources(object.sources_found);
  return {
    bucket,
    queries_run: asStringArray(object.queries_run),
    sources_found: sources,
    searched_but_no_signal: object.searched_but_no_signal === true || sources.length === 0,
    uncertainties: asStringArray(object.uncertainties),
    recommended_followups: asStringArray(object.recommended_followups)
  };
}

function sdkPrompt(task: string, matrix: SourceCoverageMatrix, entry: SourceCoverageMatrix["entries"][number]): string {
  return [
    `You are ${agentForBucket(String(entry.bucket))}.`,
    "Run read-only research for the assigned source bucket and return JSON only.",
    `Task: ${task}`,
    `Bucket: ${entry.bucket}`,
    `Query seeds: ${entry.querySeeds.join(" | ")}`,
    "Required JSON keys: bucket, queries_run, sources_found, searched_but_no_signal, uncertainties, recommended_followups.",
    "Each source must include title, source_type, url_or_ref, date_or_version, claim, confidence, notes.",
    `Prompt-injection caution: ${matrix.promptInjectionCaution}`
  ].join("\n");
}

class ResearchTimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new ResearchTimeoutError(`research bucket timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function failureStatus(error: unknown): ResearchAgentRunStatus {
  if (error instanceof ResearchTimeoutError) return "timeout";
  const message = error instanceof Error ? error.message : String(error);
  if (/context|token|exhaust/i.test(message)) return "context_exhausted";
  return "failed";
}

async function runSdkBucket(
  task: string,
  cwd: string,
  matrix: SourceCoverageMatrix,
  entry: SourceCoverageMatrix["entries"][number],
  options: RunResearchOptions
): Promise<{ run: ResearchAgentRun; report: ResearcherReport }> {
  const startedAt = new Date().toISOString();
  const bucket = String(entry.bucket);
  const runner = options.sdkPromptRunner ?? ((prompt: string, runCwd: string) => runIsolatedCodexPrompt(prompt, runCwd, true));
  try {
    const raw = await withTimeout(runner(sdkPrompt(task, matrix, entry), cwd, bucket), options.perBucketTimeoutMs ?? options.sdkTimeoutMs ?? DEFAULT_PER_BUCKET_TIMEOUT_MS);
    const report = parsedResearcherReport(raw, bucket) ?? reportForEntry(entry, false);
    const endedAt = new Date().toISOString();
    const sourcesFoundCount = report.sources_found.length;
    const searchedButNoSignal = report.searched_but_no_signal || sourcesFoundCount === 0;
    return {
      run: {
        agent: agentForBucket(bucket),
        bucket,
        status: "completed",
        startedAt,
        endedAt,
        queries_run: report.queries_run.length > 0 ? report.queries_run : entry.querySeeds,
        sources_found_count: sourcesFoundCount,
        searched_but_no_signal: searchedButNoSignal,
        failure_reason: "",
        fallback_used: false
      },
      report: { ...report, searched_but_no_signal: searchedButNoSignal }
    };
  } catch (error) {
    const endedAt = new Date().toISOString();
    const status = failureStatus(error);
    const reason = error instanceof Error ? error.message : String(error);
    return {
      run: {
        agent: agentForBucket(bucket),
        bucket,
        status,
        startedAt,
        endedAt,
        queries_run: entry.querySeeds,
        sources_found_count: 0,
        searched_but_no_signal: false,
        failure_reason: reason,
        fallback_used: status !== "timeout",
      },
      report: {
        ...reportForEntry(entry, false),
        uncertainties: [reason],
        recommended_followups: [`Rerun ${agentForBucket(bucket)} for ${bucket}; previous status was ${status}.`]
      }
    };
  }
}

function bucketPriority(bucket: string): number {
  const priorities: Record<string, number> = {
    local_repo: 1,
    official_docs: 2,
    github: 3,
    codex_default_discovery: 4,
    competitors: 5,
    academic: 6,
    package_registry: 7,
    security: 7,
    community: 8,
    blogs_engineering: 8
  };
  return priorities[bucket] ?? 9;
}

function timedOutBucketResult(entry: SourceCoverageMatrix["entries"][number], reason: string): { run: ResearchAgentRun; report: ResearcherReport } {
  const now = new Date().toISOString();
  const bucket = String(entry.bucket);
  return {
    run: {
      agent: agentForBucket(bucket),
      bucket,
      status: "timeout",
      startedAt: now,
      endedAt: now,
      queries_run: entry.querySeeds,
      sources_found_count: 0,
      searched_but_no_signal: false,
      failure_reason: reason,
      fallback_used: false
    },
    report: {
      ...reportForEntry(entry, false),
      uncertainties: [reason],
      recommended_followups: [`Rerun ${agentForBucket(bucket)} for ${bucket}; previous run exceeded the global budget.`]
    }
  };
}

function emitProgress(options: RunResearchOptions, event: ResearchProgressEvent): void {
  options.progress?.(event);
}

async function runBucketsWithConcurrency(
  task: string,
  cwd: string,
  matrix: SourceCoverageMatrix,
  entries: SourceCoverageMatrix["entries"],
  options: RunResearchOptions
): Promise<Array<{ run: ResearchAgentRun; report: ResearcherReport }>> {
  const sorted = [...entries].sort((a, b) => bucketPriority(String(a.bucket)) - bucketPriority(String(b.bucket)));
  const results = new Array<{ run: ResearchAgentRun; report: ResearcherReport }>(sorted.length);
  const maxConcurrent = Math.max(1, options.maxConcurrentBuckets ?? DEFAULT_MAX_CONCURRENT_BUCKETS);
  const globalDeadline = Date.now() + (options.globalBudgetMs ?? DEFAULT_GLOBAL_BUDGET_MS);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < sorted.length) {
      const index = nextIndex;
      nextIndex += 1;
      const entry = sorted[index];
      if (!entry) continue;
      if (Date.now() >= globalDeadline) {
        results[index] = timedOutBucketResult(entry, `research global budget exceeded before ${entry.bucket} could start`);
        emitProgress(options, {
          bucket: String(entry.bucket),
          agent: agentForBucket(String(entry.bucket)),
          status: "timeout",
          message: `global budget exceeded before ${entry.bucket} could start`
        });
        continue;
      }
      emitProgress(options, {
        bucket: String(entry.bucket),
        agent: agentForBucket(String(entry.bucket)),
        status: "started",
        message: `starting ${entry.bucket} researcher`
      });
      results[index] = await runSdkBucket(task, cwd, matrix, entry, options);
      emitProgress(options, {
        bucket: results[index].run.bucket,
        agent: results[index].run.agent,
        status: results[index].run.status,
        message: results[index].run.failure_reason || `${entry.bucket} researcher finished`
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, sorted.length) }, () => worker()));
  return results.filter((result): result is { run: ResearchAgentRun; report: ResearcherReport } => result !== undefined);
}

function legacyStepRunner(options: RunResearchOptions): SdkResearchStepRunner | undefined {
  if (options.sdkStepRunner) return options.sdkStepRunner;
  if (!options.sdkPromptRunner) return undefined;
  return async ({ prompt, cwd, bucket }) => options.sdkPromptRunner?.(prompt, cwd, bucket) ?? "{}";
}

function bucketStatusFromSdkWorker(worker: SdkWorkerRun, report: ResearcherReport): ResearchBucketStatus {
  if (report.sources_found.length > 0) return "completed";
  if (report.searched_but_no_signal) return "searched_but_no_signal";
  if (worker.status === "timeout" || worker.status === "needs_resume") return "timeout";
  if (/context|token|exhaust/i.test(worker.failure_reason)) return "context_exhausted";
  return "failed";
}

function bucketStatusesFromSdkPool(requiredBuckets: string[], pool: SdkResearchPoolResult): Record<string, ResearchBucketStatus> {
  const reports = new Map(pool.researcherReports.map((report) => [report.bucket, report]));
  const statuses: Record<string, ResearchBucketStatus> = {};
  for (const worker of pool.workerRuns) {
    statuses[worker.bucket] = bucketStatusFromSdkWorker(worker, reports.get(worker.bucket) ?? {
      bucket: worker.bucket,
      queries_run: [],
      sources_found: [],
      searched_but_no_signal: false,
      uncertainties: [],
      recommended_followups: []
    });
  }
  for (const bucket of requiredBuckets) {
    if (!statuses[bucket]) statuses[bucket] = "failed";
  }
  return normalizeBucketStatuses(requiredBuckets, statuses);
}

function sdkReportStatus(runnerMode: ResearchRunnerMode, pool: SdkResearchPoolResult, report: ResearchReport, plan: CoveragePlan): ResearchReport["status"] {
  const requiredBuckets = plan.sourceBuckets.filter((bucket) => bucket.required).map((bucket) => bucket.bucket);
  const criticalBuckets = plan.sourceBuckets.filter((bucket) => bucket.required && bucket.priority === "critical").map((bucket) => bucket.bucket);
  const evidenceBuckets = new Set([
    ...report.searched_sources_table.map((source) => source.bucket).filter((bucket): bucket is string => Boolean(bucket)),
    ...report.searched_but_no_signal
  ]);
  const evidenceGatePassed = requiredBuckets.length > 0 && requiredBuckets.every((bucket) => evidenceBuckets.has(bucket));
  const allCriticalFailed =
    criticalBuckets.length > 0 &&
    criticalBuckets.every((bucket) => {
      const status = report.bucket_statuses[bucket];
      return (status === "failed" || status === "timeout" || status === "context_exhausted") && !evidenceBuckets.has(bucket);
    });
  const allRequiredFailed =
    requiredBuckets.length > 0 &&
    requiredBuckets.every((bucket) => {
      const status = report.bucket_statuses[bucket];
      return (status === "failed" || status === "timeout" || status === "context_exhausted") && !evidenceBuckets.has(bucket);
    });
  if (runnerMode === "strict_programmatic" && (pool.workerRuns.length === 0 || allCriticalFailed || allRequiredFailed || pool.sdk_worker_status === "failed")) return "failed";
  if (runnerMode === "strict_programmatic" && evidenceGatePassed && pool.sdk_worker_status === "completed") return "completed";
  if (runnerMode === "strict_programmatic" && evidenceGatePassed && pool.sdk_worker_status === "degraded") return "degraded";
  if (pool.sdk_worker_status === "completed") return report.searched_sources_table.length > 0 || report.searched_but_no_signal.length > 0 ? "completed" : "failed";
  if (pool.sdk_worker_status === "failed") return "failed";
  return "degraded";
}

function applySdkReportFindings(report: ResearchReport, pool: SdkResearchPoolResult): void {
  const claims = new Set<string>();
  const refs = new Set<string>();
  for (const source of pool.researcherReports.flatMap((item) => item.sources_found)) {
    if (source.claim) claims.add(source.claim);
    if (source.url_or_ref) refs.add(source.url_or_ref);
  }
  report.useful_findings = [...new Set([...report.useful_findings, ...claims])];
  report.citations_or_refs = [...new Set([...report.citations_or_refs, ...refs])];
}

function refreshCoverageSummary(report: ResearchReport): void {
  const requiredBuckets = report.required_buckets ?? [];
  report.coverageMode = report.coverageMode ?? report.source_matrix?.coverageMode;
  report.requiredBucketCount = requiredBuckets.length;
  report.completedRequiredBucketCount = requiredBuckets.filter((bucket) => completedRequiredStatus(report.bucket_statuses?.[bucket])).length;
  const statusNoSignal = requiredBuckets.filter((bucket) => report.bucket_statuses?.[bucket] === "searched_but_no_signal");
  report.searched_but_no_signal = [...new Set([...(report.searched_but_no_signal ?? []), ...statusNoSignal])];
  report.searchedButNoSignalCount = report.searched_but_no_signal.length;
  report.excludedBuckets = report.source_matrix?.excludedBuckets ?? report.excludedBuckets ?? [];
  report.excludedBucketCount = report.excludedBuckets.length;
  report.skippedPossibleBuckets = report.source_matrix?.skippedPossibleBuckets ?? report.skippedPossibleBuckets ?? [];
  report.coverageDebt = report.source_matrix?.coverageDebt ?? report.coverageDebt ?? [];
  report.source_gaps = requiredBuckets.filter((bucket) => !completedRequiredStatus(report.bucket_statuses?.[bucket]));
}

function mergeSdkPoolIntoReport(cwd: string, report: ResearchReport, pool: SdkResearchPoolResult, plan: CoveragePlan): ResearchReport {
  const reportByBucket = new Map(report.researcher_reports.map((item) => [item.bucket, item]));
  for (const sdkReport of pool.researcherReports) {
    reportByBucket.set(sdkReport.bucket, sdkReport);
  }
  report.researcher_reports = [...reportByBucket.values()];

  const runKey = (run: ResearchAgentRun) => `${run.agent}\u0000${run.bucket}\u0000${run.fallback_used}`;
  const runByKey = new Map(report.agent_runs.map((run) => [runKey(run), run]));
  for (const sdkRun of pool.agentRuns) runByKey.set(runKey(sdkRun), sdkRun);
  report.agent_runs = [...runByKey.values()];

  const workerByBucket = new Map((report.sdk_worker_runs ?? []).map((run) => [run.bucket, run]));
  for (const worker of pool.workerRuns) workerByBucket.set(worker.bucket, worker);
  report.sdk_worker_runs = [...workerByBucket.values()];
  report.sdk_worker_status = pool.sdk_worker_status;
  report.programmaticMultiAgent = report.sdk_worker_runs.length > 0;
  report.sdk_threads_started = report.sdk_worker_runs.length > 0;
  report.sdk_threads_allowed = true;
  report.subagent_status = "not_applicable";
  report.subagent_trigger_source = "sdk_threads";
  report.subagent_skip_reason = "SDK worker pool was used; no App subagent spawn was recorded.";
  report.app_subagent_status = "not_applicable";

  const existingSources = new Set(report.searched_sources_table.map(sourceKey));
  for (const source of pool.researcherReports.flatMap((item) => item.sources_found.map((source) => ({ ...source, bucket: source.bucket ?? item.bucket })))) {
    if (existingSources.has(sourceKey(source))) continue;
    existingSources.add(sourceKey(source));
    report.searched_sources_table.push(source);
  }

  const nextStatuses = bucketStatusesFromSdkPool(report.required_buckets, pool);
  for (const [bucket, status] of Object.entries(nextStatuses)) {
    if (shouldReplaceBucketStatus(report.bucket_statuses[bucket], status)) report.bucket_statuses[bucket] = status;
  }
  for (const sdkReport of pool.researcherReports) {
    if (sdkReport.searched_but_no_signal && !report.searched_but_no_signal.includes(sdkReport.bucket)) {
      report.searched_but_no_signal.push(sdkReport.bucket);
    }
  }

  report.evidence_mode = report.evidence_mode && report.evidence_mode !== "none" && report.evidence_mode !== "sdk_threads" ? "mixed" : "sdk_threads";
  report.status = sdkReportStatus(report.runner_mode, pool, report, plan);
  report.manual_backfill_required = report.status !== "completed";
  applySdkReportFindings(report, pool);
  return writeResearchReport(cwd, report);
}

function writeRunMetadata(cwd: string, report: ResearchReport): void {
  const target = researchRunMetadataPath(cwd, report.runId);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        runId: report.runId,
        owner: report.owner,
        promptHash: report.promptHash,
        parentTaskPromptHash: report.parentTaskPromptHash,
        triggerSource: report.triggerSource,
        programmaticTrigger: report.programmaticTrigger,
        programmaticMultiAgent: report.programmaticMultiAgent,
        runner_mode: report.runner_mode,
        evidence_mode: report.evidence_mode,
        strict_programmatic: report.strict_programmatic,
        failure_reason: report.failure_reason,
        status: report.status,
        generatedAt: report.generatedAt,
        currentPointerUpdatedAt: report.currentPointerUpdatedAt
      },
      null,
      2
    )}\n`
  );
}

function writeParentResearchReport(cwd: string, report: ResearchReport, updateCurrent = true): ResearchReport {
  if (report.owner !== "parent") throw new Error("Only parent research reports can be written through the parent report writer.");
  const now = new Date().toISOString();
  report.generatedAt = report.generatedAt || now;
  if (updateCurrent) report.currentPointerUpdatedAt = now;
  refreshCoverageSummary(report);
  const runTarget = researchRunReportPath(cwd, report.runId);
  mkdirSync(dirname(runTarget), { recursive: true });
  writeFileSync(runTarget, `${JSON.stringify(report, null, 2)}\n`);
  if (updateCurrent) {
    const currentTarget = currentResearchReportPath(cwd);
    mkdirSync(dirname(currentTarget), { recursive: true });
    writeFileSync(currentTarget, `${JSON.stringify(report, null, 2)}\n`);
  }
  writeRunMetadata(cwd, report);
  return report;
}

export async function runResearch(task: string, cwd: string, options: RunResearchOptions = {}): Promise<ResearchReport> {
  const sourceRoot = options.sourceRoot ?? cwd;
  const parts = taskParts(task, options);
  const requestedRunnerMode: ResearchRunnerMode | undefined = options.strictProgrammatic ? "strict_programmatic" : options.executeSdkResearch ? "sdk_threads" : options.runnerMode;
  if (requestedRunnerMode === "mixed") throw new Error("runnerMode=mixed is a report state created after backfill; use app_handoff, manual_fallback, or sdk_threads.");
  const triggerSource = options.triggerSource ?? "cli_command";
  const programmaticTrigger = options.programmaticTrigger ?? true;
  const marker = createHookMarker({
    cwd,
    prompt: parts.rawUserPrompt,
    sourceRoot,
    taskType: "research-heavy",
    requiresSourceMatrix: true,
    requiresExecutorManifest: false,
    requiresValidation: false,
    runId: options.runId,
    triggerSource,
    programmaticTrigger,
    input: options.input ?? {}
  });
  appendHookEvent(cwd, {
    eventName: "CLI",
    command: "research",
    runId: marker.runId,
    turnId: marker.turnId,
    promptHash: marker.promptHash,
    triggerSource,
    programmaticTrigger
  });
  let routerOutput = options.routerOutput;
  let routerTraceWritten = false;
  let routerTraceReused = false;
  let routerTracePath = researchRunRouterTracePath(cwd, marker.runId);
  let routerTraceReuseReason = options.routerOutput ? "Router output was provided by caller." : undefined;
  let routerTraceStaleReason: string | undefined;
  const existingTrace = resolveExistingParentRouterTrace(cwd, marker.runId, parts);

  if (!routerOutput && !options.runRouter && existingTrace.output) {
    routerOutput = existingTrace.output;
    routerTraceReused = true;
    routerTraceWritten = true;
    routerTracePath = existingTrace.path;
    routerTraceReuseReason = existingTrace.reuseReason;
  } else if (!routerOutput && existingTrace.staleReason) {
    routerTraceStaleReason = existingTrace.staleReason;
    routerTracePath = existingTrace.path;
  }

  if (!routerOutput && options.runRouter) {
    routerTraceReuseReason = existingTrace.output || existsSync(existingTrace.path)
      ? "runRouter=true explicitly replaced the existing parent router_trace."
      : "runRouter=true generated a fresh parent router_trace.";
    const routed = await runLlmRouter(
      {
        rawUserPrompt: parts.rawUserPrompt,
        normalizedTask: parts.normalizedTask,
        currentRunId: marker.runId,
        triggerSource,
        programmaticTrigger,
        previousHookMarker: { ...marker }
      },
      {
        cwd,
        timeoutMs: options.routerTimeoutMs,
        promptRunner: options.routerPromptRunner,
        turnId: marker.turnId,
        writeTrace: true,
        triggerSource,
        programmaticTrigger
      }
    );
    routerOutput = routed.output;
    routerTracePath = researchRunRouterTracePath(cwd, marker.runId);
    routerTraceWritten = true;
  }
  if (!routerOutput) {
    routerOutput = routerFailedOutput("Router output was not provided; no keyword fallback used.");
    writeRouterTrace(
      cwd,
      buildRouterTrace(
        {
          rawUserPrompt: parts.rawUserPrompt,
          normalizedTask: parts.normalizedTask,
          currentRunId: marker.runId,
          triggerSource,
          programmaticTrigger,
          previousHookMarker: { ...marker }
        },
        routerOutput,
        "router_failed",
        "Router output was not provided; no keyword fallback used.",
        marker.turnId,
        { triggerSource, programmaticTrigger }
      ),
      true
    );
    routerTraceWritten = true;
    routerTraceReuseReason = "No reusable routerOutput was available; wrote router_failed trace without keyword fallback.";
    routerTracePath = researchRunRouterTracePath(cwd, marker.runId);
  }
  if (!routerTraceWritten) {
    writeRouterTrace(
      cwd,
      buildRouterTrace(
        {
          rawUserPrompt: parts.rawUserPrompt,
          normalizedTask: parts.normalizedTask,
          currentRunId: marker.runId,
          triggerSource,
          programmaticTrigger,
          previousHookMarker: { ...marker }
        },
        routerOutput,
        routerOutput.route === "bypass" || routerOutput.bypass.requested ? "semantic_bypass" : "llm",
        undefined,
        marker.turnId,
        { triggerSource, programmaticTrigger }
      ),
      true
    );
    routerTracePath = researchRunRouterTracePath(cwd, marker.runId);
  }

  const runnerMode: ResearchRunnerMode = requestedRunnerMode ?? (routerOutput.route === "research" ? "strict_programmatic" : "app_handoff");
  const effectiveStrictProgrammatic = options.strictProgrammatic === true || runnerMode === "strict_programmatic";
  const effectiveCoverageMode: CoverageMode | undefined =
    options.coverageMode ?? (runnerMode === "strict_programmatic" && routerOutput.route === "research" ? "exhaustive" : undefined);
  const effectiveParallelPolicy: ParallelPolicy | undefined =
    options.parallelPolicy ?? (runnerMode === "strict_programmatic" && effectiveCoverageMode === "exhaustive" ? "all_required" : undefined);

  const coveragePlan = writeCoveragePlan(
    cwd,
    buildCoveragePlan(routerOutput, parts.rawUserPrompt, {
      runId: marker.runId,
      normalizedTask: parts.normalizedTask,
      coverageMode: effectiveCoverageMode
    })
  );

  const reportTraceFields = {
    routerTraceReused,
    routerTracePath,
    routerTraceReuseReason,
    routerTraceStaleReason,
    triggerSource,
    programmaticTrigger,
    strictProgrammatic: effectiveStrictProgrammatic,
    coverageMode: effectiveCoverageMode,
    parallelPolicy: effectiveParallelPolicy
  };

  const strictRequiredBuckets = coveragePlan.requiredBuckets.length > 0 ? coveragePlan.requiredBuckets : coveragePlan.sourceBuckets.filter((bucket) => bucket.required).map((bucket) => bucket.bucket);
  if (runnerMode === "strict_programmatic" && strictRequiredBuckets.length === 0) {
    const failureReason = "strict_programmatic requires non-empty required buckets";
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "failed", {
      ...options,
      ...reportTraceFields,
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "strict_programmatic",
      evidenceMode: "none",
      failureReason,
      manualFallbackReason: failureReason,
      subagentStatus: "failed",
      subagentTriggerSource: "sdk_threads",
      subagentSkipReason: failureReason,
      sdkThreadsStarted: false,
      sdkThreadsAllowed: true,
      appHandoffRequired: false,
      manualBackfillRequired: false,
      programmaticMultiAgent: false,
      bucketStatuses: {},
      agentRuns: [],
      researcherReports: []
    });
    report.status = "failed";
    report.source_gaps = [];
    return writeParentResearchReport(cwd, report, true);
  }

  if (runnerMode === "app_handoff") {
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "not_configured", {
      ...options,
      ...reportTraceFields,
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "app_handoff",
      manualFallbackReason: options.manualFallbackReason ?? DEFAULT_APP_HANDOFF_REASON,
      subagentStatus: options.subagentStatus ?? "not_spawned",
      subagentTriggerSource: options.subagentTriggerSource ?? "none",
      subagentSkipReason: options.subagentSkipReason ?? "App subagents have not been observed as spawned for this run; backfill manual/App evidence or use strict SDK threads.",
      appHandoffRequired: true,
      sdkThreadsStarted: false,
      sdkThreadsAllowed: false,
      subagentInstructionInjected: true,
      manualBackfillRequired: true
    });
    return writeParentResearchReport(cwd, report, true);
  }

  if (runnerMode === "manual_fallback") {
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "not_configured", {
      ...options,
      ...reportTraceFields,
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "manual_fallback",
      manualFallbackReason: options.manualFallbackReason ?? "Manual fallback explicitly requested.",
      subagentStatus: options.subagentStatus ?? "not_applicable",
      subagentTriggerSource: options.subagentTriggerSource ?? "manual"
    });
    return writeParentResearchReport(cwd, report, true);
  }

  const sdkStatus = codexRunnerStatus();
  const sdkAvailable = options.sdkAvailable ?? (sdkStatus.codexExportAvailable && sdkStatus.threadExportAvailable);
  if (!sdkAvailable && runnerMode === "strict_programmatic") {
    const failureReason = "sdk_threads runner unavailable";
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "failed", {
      ...options,
      ...reportTraceFields,
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "strict_programmatic",
      evidenceMode: "none",
      failureReason,
      manualFallbackReason: failureReason,
      subagentStatus: "failed",
      subagentTriggerSource: "sdk_threads",
      subagentSkipReason: failureReason,
      sdkThreadsStarted: false,
      sdkThreadsAllowed: true,
      appHandoffRequired: false,
      manualBackfillRequired: false,
      programmaticMultiAgent: false,
      bucketStatuses: {},
      agentRuns: [],
      researcherReports: []
    });
    report.status = "failed";
    report.source_gaps = report.required_buckets;
    return writeParentResearchReport(cwd, report, true);
  }

  if (!sdkAvailable) {
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "not_configured", {
      ...options,
      ...reportTraceFields,
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "manual_fallback",
      manualFallbackReason: "Codex SDK runner is unavailable.",
      subagentStatus: "unavailable",
      subagentTriggerSource: "none",
      subagentSkipReason: "Codex SDK runner is unavailable and strict programmatic mode was not requested.",
      sdkThreadsStarted: false,
      sdkThreadsAllowed: true,
      manualBackfillRequired: true
    });
    return writeParentResearchReport(cwd, report, true);
  }

  let matrix = sourceMatrixForTask(task, {
    ...options,
    routerOutput,
    runId: marker.runId,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    coverageMode: effectiveCoverageMode
  });
  if (options.defaultDiscoveryBuckets?.length) {
    matrix = applyDefaultDiscoveryFindings(matrix, options.defaultDiscoveryBuckets);
  }
  const requiredEntries = matrix.entries.filter((entry) => entry.required);
  if (runnerMode === "strict_programmatic" && requiredEntries.length === 0) {
    const failureReason = "strict_programmatic started zero workers";
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "failed", {
      ...options,
      ...reportTraceFields,
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "strict_programmatic",
      evidenceMode: "none",
      failureReason,
      manualFallbackReason: failureReason,
      subagentStatus: "failed",
      subagentTriggerSource: "sdk_threads",
      subagentSkipReason: failureReason,
      sdkThreadsStarted: false,
      sdkThreadsAllowed: true,
      appHandoffRequired: false,
      manualBackfillRequired: false,
      programmaticMultiAgent: false,
      bucketStatuses: {},
      agentRuns: [],
      researcherReports: []
    });
    report.status = "failed";
    report.source_gaps = strictRequiredBuckets;
    return writeParentResearchReport(cwd, report, true);
  }
  const requiredBuckets = requiredEntries.map((entry) => String(entry.bucket));
  const defaultMaxConcurrentBuckets =
    runnerMode === "strict_programmatic" && effectiveParallelPolicy === "all_required" ? Math.max(1, requiredBuckets.length) : DEFAULT_SDK_MAX_CONCURRENT_BUCKETS;
  const pool = await runSdkResearchPool({
    runId: marker.runId,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    coveragePlan,
    sourceMatrix: matrix,
    requiredBuckets,
    cwd,
    maxConcurrentBuckets: options.maxConcurrentBuckets ?? defaultMaxConcurrentBuckets,
    workerLeaseMs: options.workerLeaseMs ?? DEFAULT_SDK_WORKER_LEASE_MS,
    softTimeoutMs: options.softTimeoutMs ?? options.perBucketTimeoutMs ?? options.sdkTimeoutMs ?? DEFAULT_SDK_SOFT_TIMEOUT_MS,
    hardTimeoutMs: options.hardTimeoutMs ?? options.perBucketTimeoutMs ?? options.sdkTimeoutMs ?? DEFAULT_SDK_HARD_TIMEOUT_MS,
    globalBudgetMs: options.globalBudgetMs ?? DEFAULT_SDK_GLOBAL_BUDGET_MS,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_SDK_HEARTBEAT_INTERVAL_MS,
    maxNoProgressHeartbeats: options.maxNoProgressHeartbeats ?? DEFAULT_SDK_MAX_NO_PROGRESS_HEARTBEATS,
    maxSourcesPerWorker: options.maxSourcesPerWorker,
    maxRetriesPerWorker: options.maxRetriesPerWorker,
    retryInitialBackoffMs: options.retryInitialBackoffMs,
    retryMaxBackoffMs: options.retryMaxBackoffMs,
    retryJitter: options.retryJitter,
    maxNoArtifactProgressIntervals: options.maxNoArtifactProgressIntervals,
    maxNoSemanticProgressIntervals: options.maxNoSemanticProgressIntervals,
    checkpointNudgeTimeoutMs: options.checkpointNudgeTimeoutMs,
    maxCheckpointNudges: options.maxCheckpointNudges,
    sdkStepRunner: legacyStepRunner(options)
  });
  if (runnerMode === "strict_programmatic" && pool.workerRuns.length === 0) {
    const failureReason = "strict_programmatic started zero workers";
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "failed", {
      ...options,
      ...reportTraceFields,
      turnId: marker.turnId,
      runId: marker.runId,
      routerOutput,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "strict_programmatic",
      evidenceMode: "none",
      failureReason,
      manualFallbackReason: failureReason,
      subagentStatus: "failed",
      subagentTriggerSource: "sdk_threads",
      subagentSkipReason: failureReason,
      sdkThreadsStarted: false,
      sdkThreadsAllowed: true,
      appHandoffRequired: false,
      manualBackfillRequired: false,
      programmaticMultiAgent: false,
      sdkWorkerStatus: "failed",
      sdkWorkerRuns: [],
      bucketStatuses: {},
      agentRuns: [],
      researcherReports: []
    });
    report.status = "failed";
    report.source_gaps = strictRequiredBuckets;
    return writeParentResearchReport(cwd, report, true);
  }
  const agentRuns = pool.agentRuns;
  const researcherReports = pool.researcherReports;
  const bucketStatuses = bucketStatusesFromSdkPool(requiredBuckets, pool);
  const codexRun = agentRuns.find((run) => run.bucket === "codex_default_discovery");
  const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], codexDefaultStatusFromRun(codexRun, "not_configured"), {
    ...options,
    ...reportTraceFields,
    turnId: marker.turnId,
    runId: marker.runId,
    routerOutput,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    runnerMode,
    evidenceMode: "sdk_threads",
    subagentStatus: "not_applicable",
    subagentTriggerSource: "sdk_threads",
    subagentSkipReason: "SDK worker pool was used; no App subagent spawn was recorded.",
    sdkThreadsStarted: pool.workerRuns.length > 0,
    sdkThreadsAllowed: true,
    appHandoffRequired: false,
    subagentInstructionInjected: false,
    appSubagentStatus: "not_applicable",
    programmaticMultiAgent: pool.programmaticMultiAgent,
    agentRuns,
    bucketStatuses,
    researcherReports,
    sdkWorkerStatus: pool.sdk_worker_status,
    sdkWorkerRuns: pool.workerRuns,
    failureReason: pool.sdk_worker_status === "failed" ? pool.failureReason : undefined
  });
  report.status = sdkReportStatus(runnerMode, pool, report, coveragePlan);
  report.manual_backfill_required = report.status !== "completed";
  report.source_gaps = report.required_buckets.filter((bucket) => report.bucket_statuses[bucket] !== "completed" && report.bucket_statuses[bucket] !== "searched_but_no_signal");
  applySdkReportFindings(report, pool);
  const written = writeParentResearchReport(cwd, report, true);
  return written;
}

export async function resumeResearchRun(cwd: string, runId: string, options: RunResearchOptions = {}): Promise<ResearchReport> {
  const report = loadResearchReport(cwd, runId);
  if (report.runner_mode !== "sdk_threads" && report.runner_mode !== "strict_programmatic") {
    throw new Error(`research resume only supports sdk_threads or strict_programmatic reports; got ${report.runner_mode}.`);
  }
  const plan = maybeLoadCoveragePlan(cwd, report.runId);
  if (!plan) throw new Error(`coverage_plan.json is missing for runId=${report.runId}.`);
  const resumableBuckets = listSdkWorkerStates(cwd, report.runId)
    .filter((worker) => (worker.status === "needs_resume" || worker.status === "timeout" || worker.status === "failed") && Boolean(worker.threadId || worker.workerId))
    .map((worker) => worker.bucket);
  if (resumableBuckets.length === 0) return report;
  const pool = await runSdkResearchPool({
    runId: report.runId,
    rawUserPrompt: report.rawUserPrompt,
    normalizedTask: report.normalizedTask,
    coveragePlan: plan,
    sourceMatrix: report.source_matrix,
    requiredBuckets: resumableBuckets,
    cwd,
    maxConcurrentBuckets: options.maxConcurrentBuckets ?? (plan.coverageMode === "exhaustive" ? Math.max(1, resumableBuckets.length) : DEFAULT_SDK_MAX_CONCURRENT_BUCKETS),
    workerLeaseMs: options.workerLeaseMs ?? DEFAULT_SDK_WORKER_LEASE_MS,
    softTimeoutMs: options.softTimeoutMs ?? options.perBucketTimeoutMs ?? options.sdkTimeoutMs ?? DEFAULT_SDK_SOFT_TIMEOUT_MS,
    hardTimeoutMs: options.hardTimeoutMs ?? options.perBucketTimeoutMs ?? options.sdkTimeoutMs ?? DEFAULT_SDK_HARD_TIMEOUT_MS,
    globalBudgetMs: options.globalBudgetMs ?? DEFAULT_SDK_GLOBAL_BUDGET_MS,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_SDK_HEARTBEAT_INTERVAL_MS,
    maxNoProgressHeartbeats: options.maxNoProgressHeartbeats ?? DEFAULT_SDK_MAX_NO_PROGRESS_HEARTBEATS,
    maxSourcesPerWorker: options.maxSourcesPerWorker,
    maxRetriesPerWorker: options.maxRetriesPerWorker,
    retryInitialBackoffMs: options.retryInitialBackoffMs,
    retryMaxBackoffMs: options.retryMaxBackoffMs,
    retryJitter: options.retryJitter,
    maxNoArtifactProgressIntervals: options.maxNoArtifactProgressIntervals,
    maxNoSemanticProgressIntervals: options.maxNoSemanticProgressIntervals,
    checkpointNudgeTimeoutMs: options.checkpointNudgeTimeoutMs,
    maxCheckpointNudges: options.maxCheckpointNudges,
    sdkStepRunner: legacyStepRunner(options),
    resume: true
  });
  return mergeSdkPoolIntoReport(cwd, report, pool, plan);
}

export function listResearchWorkers(cwd: string, runId: string): ReturnType<typeof listSdkWorkerStates> {
  return listSdkWorkerStates(cwd, runId);
}

export function cancelResearchWorker(cwd: string, runId: string, bucket: string): ReturnType<typeof cancelSdkWorker> {
  return cancelSdkWorker(cwd, runId, bucket);
}

export interface ManualSourceInput {
  runId?: string;
  bucket: string;
  title: string;
  source_type?: string;
  url_or_ref: string;
  date_or_version?: string;
  claim: string;
  confidence?: ResearchSource["confidence"];
  notes?: string;
  finding?: string;
  citation?: string;
}

function resolveReportRunId(cwd: string, explicitRunId?: string): string {
  if (explicitRunId?.trim()) return explicitRunId.trim();
  const marker = resolveLatestActiveMarker(cwd);
  if (marker?.runId) return marker.runId;
  throw new Error("No current hardflow runId was found. Run codex-hardflow research --runner app_handoff first, or pass --run-id <runId>.");
}

export function loadResearchReport(cwd: string, runId?: string): ResearchReport {
  const resolvedRunId = resolveReportRunId(cwd, runId);
  const target = researchRunReportPath(cwd, resolvedRunId);
  if (!existsSync(target)) throw new Error(`research_report.json is missing for runId=${resolvedRunId}; run codex-hardflow research --runner app_handoff first.`);
  return JSON.parse(readFileSync(target, "utf8")) as ResearchReport;
}

function writeResearchReport(cwd: string, report: ResearchReport): ResearchReport {
  report.generatedAt = new Date().toISOString();
  return writeParentResearchReport(cwd, report, true);
}

function evidenceQueryForBucket(plan: CoveragePlan | undefined, bucket: string, fallback: string): string {
  return plan?.researchQuestions.find((question) => question.bucket === bucket)?.question ?? fallback;
}

function recordSourceEvidence(cwd: string, runId: string, source: ResearchSource, engine: string, queryFallback: string, plan?: CoveragePlan): void {
  const bucket = source.bucket ?? "codex_default_discovery";
  addEvidence(cwd, {
    runId,
    bucket,
    engine,
    query: evidenceQueryForBucket(plan, bucket, queryFallback),
    sourceType: source.source_type,
    title: source.title,
    urlOrRef: source.url_or_ref,
    dateOrVersion: source.date_or_version,
    claim: source.claim,
    confidence: source.confidence,
    perspectiveId: perspectiveForBucket(plan, bucket),
    researchQuestionId: researchQuestionForBucket(plan, bucket)
  });
}

function recordNoSignalEvidence(cwd: string, runId: string, bucket: string, engine: string, queryFallback: string, plan?: CoveragePlan): void {
  addEvidence(cwd, {
    runId,
    bucket,
    engine,
    query: evidenceQueryForBucket(plan, bucket, queryFallback),
    sourceType: "searched_but_no_signal",
    title: `No signal recorded for ${bucket}`,
    urlOrRef: `no-signal:${runId}:${bucket}`,
    dateOrVersion: "not_applicable",
    claim: `${engine} searched ${bucket} and recorded searched_but_no_signal.`,
    confidence: "low",
    perspectiveId: perspectiveForBucket(plan, bucket),
    researchQuestionId: researchQuestionForBucket(plan, bucket)
  });
}

function recordResearcherReportsEvidence(cwd: string, runId: string, reports: ResearcherReport[], plan?: CoveragePlan): void {
  for (const researcherReport of reports) {
    const engine = agentForBucket(researcherReport.bucket);
    const queryFallback = researcherReport.queries_run.join(" | ") || researcherReport.bucket;
    for (const source of researcherReport.sources_found) {
      recordSourceEvidence(cwd, runId, { ...source, bucket: source.bucket ?? researcherReport.bucket }, engine, queryFallback, plan);
    }
    if (researcherReport.searched_but_no_signal) {
      recordNoSignalEvidence(cwd, runId, researcherReport.bucket, engine, queryFallback, plan);
    }
  }
}

function upsertResearcherReport(report: ResearchReport, source: ResearchSource): void {
  const bucket = source.bucket ?? "codex_default_discovery";
  let bucketReport = report.researcher_reports.find((item) => item.bucket === bucket);
  if (!bucketReport) {
    bucketReport = {
      bucket,
      queries_run: [],
      sources_found: [],
      searched_but_no_signal: false,
      uncertainties: [],
      recommended_followups: []
    };
    report.researcher_reports.push(bucketReport);
  }
  bucketReport.sources_found.push(source);
  bucketReport.searched_but_no_signal = false;
}

function upsertManualAgentRun(report: ResearchReport, bucket: string, sourceCount: number): void {
  const now = new Date().toISOString();
  let run = report.agent_runs.find((item) => item.bucket === bucket && item.fallback_used);
  if (!run) {
    run = {
      agent: agentForBucket(bucket),
      bucket,
      status: "manual_fallback",
      startedAt: now,
      endedAt: now,
      queries_run: [],
      sources_found_count: 0,
      searched_but_no_signal: false,
      failure_reason: "Manual source backfill was used.",
      fallback_used: true
    };
    report.agent_runs.push(run);
  }
  run.endedAt = now;
  run.sources_found_count += sourceCount;
  run.searched_but_no_signal = false;
  run.failure_reason = "Manual source backfill recorded in research_report.";
}

export function addManualSourceToReport(cwd: string, input: ManualSourceInput): ResearchReport {
  const report = loadResearchReport(cwd, input.runId);
  if (report.owner !== "parent") throw new Error("Manual sources can only be added to a parent research report.");
  const plan = maybeLoadCoveragePlan(cwd, report.runId);
  const source: ResearchSource = {
    bucket: input.bucket,
    title: input.title,
    source_type: input.source_type ?? "manual",
    url_or_ref: input.url_or_ref,
    date_or_version: input.date_or_version ?? "manual",
    claim: input.claim,
    confidence: input.confidence ?? "medium",
    notes: input.notes ?? "Manual source backfilled after runner execution."
  };
  report.evidence_mode = report.evidence_mode && report.evidence_mode !== "none" && report.evidence_mode !== "manual_backfilled" ? "mixed" : "manual_backfilled";
  report.programmaticMultiAgent = hasProgrammaticWorkerRuns(report.agent_runs, report.mergedSubagentReports);
  report.manual_backfill_required = false;
  report.app_handoff_required = false;
  if (report.subagent_status !== "spawned") {
    report.subagent_status = "not_spawned";
    report.subagent_trigger_source = "manual";
    report.subagent_skip_reason = report.subagent_skip_reason ?? "Manual source backfill was used; no App subagent spawn was recorded.";
  }
  report.bucket_statuses[input.bucket] = "manual_backfilled";
  report.searched_sources_table.push(source);
  upsertResearcherReport(report, source);
  upsertManualAgentRun(report, input.bucket, 1);
  if (input.finding) report.useful_findings.push(input.finding);
  if (input.citation) report.citations_or_refs.push(input.citation);
  else report.citations_or_refs.push(input.url_or_ref);
  report.source_gaps = report.source_gaps.filter((bucket) => bucket !== input.bucket);
  report.status = reportStatusForRunner(report.runner_mode, report.bucket_statuses, report.searched_sources_table);
  recordSourceEvidence(cwd, report.runId, source, "manual_backfill", input.title, plan);
  return writeResearchReport(cwd, report);
}

export function finalizeManualReport(cwd: string, updates: { runId?: string; usefulFindings?: string[]; conflictingFindings?: string[]; sourceGaps?: string[]; citationsOrRefs?: string[]; confidenceSummary?: string } = {}): ResearchReport {
  const report = loadResearchReport(cwd, updates.runId);
  if (report.owner !== "parent") throw new Error("Only parent research reports can be finalized.");
  if (report.searched_sources_table.length > 0 && (!report.evidence_mode || report.evidence_mode === "none")) {
    report.evidence_mode = "manual_backfilled";
  }
  report.programmaticMultiAgent = hasProgrammaticWorkerRuns(report.agent_runs, report.mergedSubagentReports);
  report.manual_backfill_required = report.searched_sources_table.length === 0;
  report.app_handoff_required = report.runner_mode === "app_handoff";
  if (updates.usefulFindings) report.useful_findings.push(...updates.usefulFindings);
  if (updates.conflictingFindings) report.conflicting_findings.push(...updates.conflictingFindings);
  if (updates.sourceGaps) report.source_gaps = updates.sourceGaps;
  if (updates.citationsOrRefs) report.citations_or_refs.push(...updates.citationsOrRefs);
  if (updates.confidenceSummary) report.confidence_summary = updates.confidenceSummary;
  report.status = reportStatusForRunner(report.runner_mode, report.bucket_statuses, report.searched_sources_table);
  return writeResearchReport(cwd, report);
}

function subagentRunId(parentRunId: string, agent: string, bucket: string, endedAt: string): string {
  return `${parentRunId}-${agent}-${bucket}-${hashText(endedAt)}`;
}

export function addSubagentReport(cwd: string, input: AddSubagentReportInput): SubagentReport {
  const parentRunId = resolveReportRunId(cwd, input.parentRunId ?? input.runId);
  if (!input.agent.trim()) throw new Error("Missing subagent agent name.");
  if (!input.bucket.trim()) throw new Error("Missing subagent bucket.");
  const endedAt = input.endedAt ?? new Date().toISOString();
  const report: SubagentReport = {
    runId: input.runId ?? subagentRunId(parentRunId, input.agent, input.bucket, endedAt),
    parentRunId,
    agent: input.agent,
    bucket: input.bucket,
    status: input.status,
    sources_found: input.sources_found ?? [],
    searched_but_no_signal: input.searched_but_no_signal ?? input.status === "searched_but_no_signal",
    queries_run: input.queries_run ?? [],
    failure_reason: input.failure_reason ?? "",
    startedAt: input.startedAt ?? endedAt,
    endedAt
  };
  const target = researchSubagentReportPath(cwd, parentRunId, report.agent, report.bucket);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function subagentStatusToAgentRunStatus(status: SubagentReportStatus): ResearchAgentRunStatus {
  if (status === "searched_but_no_signal") return "completed";
  return status;
}

function subagentStatusToBucketStatus(subagent: SubagentReport): ResearchBucketStatus {
  if (subagent.status === "completed") return subagent.searched_but_no_signal || subagent.sources_found.length === 0 ? "searched_but_no_signal" : "completed";
  if (subagent.status === "searched_but_no_signal") return "searched_but_no_signal";
  return subagent.status;
}

function sourceKey(source: ResearchSource): string {
  return `${source.bucket ?? ""}\u0000${source.title}\u0000${source.url_or_ref}`;
}

function mergeSource(report: ResearchReport, bucket: string, source: ResearchSource): boolean {
  const normalized = { ...source, bucket: source.bucket ?? bucket };
  const existing = new Set(report.searched_sources_table.map(sourceKey));
  if (existing.has(sourceKey(normalized))) return false;
  report.searched_sources_table.push(normalized);
  upsertResearcherReport(report, normalized);
  return true;
}

function mergeSubagentRun(report: ResearchReport, subagent: SubagentReport, sourceCount: number): void {
  const existing = report.agent_runs.find((run) => run.agent === subagent.agent && run.bucket === subagent.bucket && !run.fallback_used);
  const next: ResearchAgentRun = {
    agent: subagent.agent,
    bucket: subagent.bucket,
    status: subagentStatusToAgentRunStatus(subagent.status),
    startedAt: subagent.startedAt,
    endedAt: subagent.endedAt,
    queries_run: subagent.queries_run,
    sources_found_count: sourceCount,
    searched_but_no_signal: subagent.searched_but_no_signal,
    failure_reason: subagent.failure_reason,
    fallback_used: false
  };
  if (existing) Object.assign(existing, next);
  else report.agent_runs.push(next);
}

function shouldReplaceBucketStatus(current: ResearchBucketStatus | undefined, next: ResearchBucketStatus): boolean {
  if (!current) return true;
  if (current === "completed" || current === "manual_backfilled") return false;
  if (next === "completed" || next === "searched_but_no_signal") return true;
  return current === "manual_fallback";
}

export function mergeSubagentReports(cwd: string, runId?: string): ResearchReport {
  const report = loadResearchReport(cwd, runId);
  if (report.owner !== "parent") throw new Error("Subagent reports can only be merged into a parent research report.");
  const plan = maybeLoadCoveragePlan(cwd, report.runId);
  const dir = researchRunSubagentsDir(cwd, report.runId);
  if (!existsSync(dir)) return writeResearchReport(cwd, report);
  const files = readdirSync(dir).filter((file) => file.endsWith(".json") && !file.endsWith(".router_trace.json"));
  for (const file of files) {
    const path = `${dir}/${file}`;
    const subagent = JSON.parse(readFileSync(path, "utf8")) as SubagentReport;
    if (subagent.parentRunId !== report.runId) continue;
    let addedSources = 0;
    for (const source of subagent.sources_found) {
      const normalizedSource = { ...source, bucket: source.bucket ?? subagent.bucket };
      if (mergeSource(report, subagent.bucket, normalizedSource)) {
        addedSources += 1;
        recordSourceEvidence(cwd, report.runId, normalizedSource, subagent.agent, subagent.queries_run.join(" | ") || subagent.bucket, plan);
      }
    }
    mergeSubagentRun(report, subagent, subagent.sources_found.length);
    const bucketStatus = subagentStatusToBucketStatus(subagent);
    if (shouldReplaceBucketStatus(report.bucket_statuses[subagent.bucket], bucketStatus)) {
      report.bucket_statuses[subagent.bucket] = bucketStatus;
    }
    if (bucketStatus === "searched_but_no_signal" && !report.searched_but_no_signal.includes(subagent.bucket)) {
      report.searched_but_no_signal.push(subagent.bucket);
      recordNoSignalEvidence(cwd, report.runId, subagent.bucket, subagent.agent, subagent.queries_run.join(" | ") || subagent.bucket, plan);
    }
    if (addedSources > 0) report.source_gaps = report.source_gaps.filter((bucket) => bucket !== subagent.bucket);
    if (!report.mergedSubagentReports.includes(file)) report.mergedSubagentReports.push(file);
  }
  if (report.searched_sources_table.length > 0) {
    report.evidence_mode = report.evidence_mode && report.evidence_mode !== "none" && report.evidence_mode !== "app_handoff" ? "mixed" : "app_handoff";
  }
  report.manual_backfill_required = report.searched_sources_table.length === 0;
  report.app_handoff_required = report.runner_mode === "app_handoff";
  if (files.length > 0) {
    report.subagent_status = "spawned";
    report.subagent_trigger_source = "app_tool";
    report.subagent_skip_reason = undefined;
  }
  report.programmaticMultiAgent = hasProgrammaticWorkerRuns(report.agent_runs, report.mergedSubagentReports);
  report.status = reportStatusForRunner(report.runner_mode, report.bucket_statuses, report.searched_sources_table);
  return writeResearchReport(cwd, report);
}

function hasNoSignalEvidence(report: ResearchReport): boolean {
  return (report.searched_but_no_signal ?? []).length > 0 || Object.values(report.bucket_statuses ?? {}).includes("searched_but_no_signal");
}

function failureOnlyStatus(status: ResearchBucketStatus | undefined): boolean {
  return status === "timeout" || status === "failed" || status === "context_exhausted" || status === "manual_fallback";
}

function sourcesForBucket(report: ResearchReport, bucket: string): ResearchSource[] {
  return (report.searched_sources_table ?? []).filter((source) => source.bucket === bucket);
}

function sourceRefSet(report: ResearchReport): Set<string> {
  const refs = new Set<string>();
  for (const source of report.searched_sources_table ?? []) {
    refs.add(source.url_or_ref);
    refs.add(source.title);
  }
  for (const ref of report.citations_or_refs ?? []) refs.add(ref);
  return refs;
}

export interface ResearchEvidenceAssertionOptions {
  finalAnswerSources?: string[];
  researchHeavy?: boolean;
}

export function assertResearchReportEvidence(report: ResearchReport, options: ResearchEvidenceAssertionOptions = {}): { passed: boolean; reason?: string } {
  if (report.owner !== "parent") {
    return { passed: false, reason: "subagent-owned research_report cannot satisfy a parent research gate." };
  }
  if (!report.runId) {
    return { passed: false, reason: "research_report is missing runId." };
  }
  if (report.programmaticTrigger !== true) {
    return { passed: false, reason: "research_report cannot claim hardflow evidence because programmaticTrigger is not true." };
  }
  if (report.triggerSource === "agents_md_only" || report.triggerSource === "skill_only" || report.triggerSource === "unknown") {
    return { passed: false, reason: `research_report triggerSource=${report.triggerSource} cannot claim programmatic hardflow evidence.` };
  }
  const requiredBuckets = report.source_matrix?.requiredBuckets?.length
    ? report.source_matrix.requiredBuckets
    : report.required_buckets ?? [];
  const isResearchHeavy = options.researchHeavy ?? /research|troubleshoot|current|solution|architecture|framework/i.test(report.taskType);

  const hasNoSignal = hasNoSignalEvidence(report);
  if (report.runner_mode === "app_handoff" && (report.searched_sources_table ?? []).length === 0 && !hasNoSignal) {
    return {
      passed: false,
      reason: "app_handoff research_report has no evidence yet. Spawn App subagents or backfill manual sources via codex-hardflow report add-source."
    };
  }
  if (report.runner_mode === "manual_fallback" && (report.searched_sources_table ?? []).length === 0 && !hasNoSignal) {
    return { passed: false, reason: "manual_fallback research_report has no sources. Backfill sources before relying on it." };
  }
  const statuses = requiredBuckets.map((bucket) => report.bucket_statuses?.[bucket]);
  if (report.coverageMode === "exhaustive") {
    const missingRequired = requiredBuckets.filter((bucket) => !completedRequiredStatus(report.bucket_statuses?.[bucket]) && sourcesForBucket(report, bucket).length === 0);
    if (missingRequired.length > 0) {
      return { passed: false, reason: `exhaustive coverage missing required bucket evidence/no-signal/exclusion: ${missingRequired.join(", ")}.` };
    }
  }
  if (report.runner_mode === "sdk_threads" && statuses.length > 0 && statuses.every((status) => status === "timeout")) {
    return { passed: false, reason: "sdk_threads research_report has all required buckets timed out; require degraded-mode confirmation or manual backfill." };
  }
  if (report.status === "failed" || (statuses.length > 0 && statuses.every(failureOnlyStatus))) {
    return { passed: false, reason: "research_report evidence gate failed: all required buckets are timeout/failed/context_exhausted/manual_fallback without usable evidence." };
  }
  if (isResearchHeavy && (report.searched_sources_table ?? []).length === 0 && !hasNoSignal) {
    return { passed: false, reason: "research-heavy report evidence gate failed: searched_sources_table is empty." };
  }
  if ((report.useful_findings ?? []).length === 0 && !hasNoSignalEvidence(report)) {
    return { passed: false, reason: "research_report evidence gate failed: useful_findings is empty and no searched_but_no_signal buckets are recorded." };
  }

  const criticalBuckets = ["official_docs", "github", "codex_default_discovery"].filter((bucket) => requiredBuckets.includes(bucket));
  if (
    criticalBuckets.length > 0 &&
    criticalBuckets.every((bucket) => failureOnlyStatus(report.bucket_statuses?.[bucket]) && sourcesForBucket(report, bucket).length === 0)
  ) {
    return { passed: false, reason: "research_report evidence gate failed: required critical buckets have no usable evidence." };
  }

  const expectedRefs = options.finalAnswerSources ?? [];
  if (expectedRefs.length > 0) {
    const refs = sourceRefSet(report);
    const missing = expectedRefs.filter((ref) => !refs.has(ref));
    if (missing.length > 0) {
      return { passed: false, reason: `final answer references sources missing from research_report: ${missing.join(", ")}` };
    }
  }

  return { passed: true };
}

export function researchReportSummary(cwd: string, runId?: string): Record<string, unknown> {
  const report = loadResearchReport(cwd, runId);
  return {
    path: researchRunReportPath(cwd, report.runId),
    currentPath: currentResearchReportPath(cwd),
    runId: report.runId,
    owner: report.owner,
    promptHash: report.promptHash,
    turnId: report.turnId,
    generatedAt: report.generatedAt,
    status: report.status,
    runner_mode: report.runner_mode,
    coverageMode: report.coverageMode,
    requiredBucketCount: report.requiredBucketCount,
    completedRequiredBucketCount: report.completedRequiredBucketCount,
    searchedButNoSignalCount: report.searchedButNoSignalCount,
    excludedBucketCount: report.excludedBucketCount,
    excludedBuckets: report.excludedBuckets,
    skippedPossibleBuckets: report.skippedPossibleBuckets,
    coverageDebt: report.coverageDebt,
    app_handoff_required: report.app_handoff_required,
    sdk_threads_started: report.sdk_threads_started,
    sdk_threads_allowed: report.sdk_threads_allowed,
    subagent_instruction_injected: report.subagent_instruction_injected,
    manual_backfill_required: report.manual_backfill_required,
    required_buckets: report.required_buckets,
    bucket_statuses: report.bucket_statuses,
    searched_sources_count: report.searched_sources_table.length,
    useful_findings_count: report.useful_findings.length,
    source_gaps: report.source_gaps
  };
}
