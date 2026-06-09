import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { codexRunnerStatus, runIsolatedCodexPrompt } from "./codexRunner.js";
import { buildSourceCoverageMatrix, applyDefaultDiscoveryFindings } from "./sourceMatrix.js";
import type {
  CodexDefaultDiscoveryStatus,
  ResearchAgentRun,
  ResearchAgentRunStatus,
  ResearchBucketStatus,
  ResearchReport,
  ResearcherReport,
  ResearchRunnerMode,
  ResearchSource,
  SourceCoverageMatrix
} from "./schemas.js";
import { researchReportPath } from "./paths.js";
import { createHookMarker, hashText } from "./hookState.js";

export interface BuildResearchReportOptions {
  rawUserPrompt?: string;
  normalizedTask?: string;
  turnId?: string;
  taskType?: string;
  runnerMode?: ResearchRunnerMode;
  manualFallbackReason?: string;
  subagentStatus?: ResearchReport["subagent_status"];
  generatedAt?: string;
  agentRuns?: ResearchAgentRun[];
  bucketStatuses?: Record<string, ResearchBucketStatus>;
  researcherReports?: ResearcherReport[];
}

export interface RunResearchOptions extends BuildResearchReportOptions {
  sourceRoot?: string;
  input?: Record<string, unknown>;
  sdkTimeoutMs?: number;
  perBucketTimeoutMs?: number;
  maxConcurrentBuckets?: number;
  globalBudgetMs?: number;
  sdkPromptRunner?: (prompt: string, cwd: string, bucket: string) => Promise<string>;
  defaultDiscoveryBuckets?: string[];
}

const DEFAULT_MANUAL_FALLBACK_REASON = "No live subagent or SDK researcher runner was configured for this local report builder.";
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

function sourceMatrixForTask(task: string, options: Pick<BuildResearchReportOptions, "rawUserPrompt" | "normalizedTask">): SourceCoverageMatrix {
  const parts = taskParts(task, options);
  const matrix = buildSourceCoverageMatrix(parts.classificationInput);
  return {
    ...matrix,
    task: parts.rawUserPrompt,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    classificationInput: parts.classificationInput
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

export function buildResearchReport(
  task: string,
  defaultDiscoveryBuckets: string[] = [],
  codexDefaultDiscoveryStatus: CodexDefaultDiscoveryStatus = "not_configured",
  options: BuildResearchReportOptions = {}
): ResearchReport {
  const parts = taskParts(task, options);
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

  return {
    task,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    classificationInput: parts.classificationInput,
    promptHash: hashText(parts.rawUserPrompt),
    turnId: options.turnId ?? `research-${hashText(task)}`,
    generatedAt,
    taskType: options.taskType ?? "research-heavy",
    status: reportStatus(bucketStatuses, researcherReports.flatMap((report) => report.sources_found)),
    runner_mode: runnerMode,
    manual_fallback_reason: runnerMode === "manual_fallback" || runnerMode === "mixed" ? manualFallbackReason : undefined,
    subagent_status: options.subagentStatus ?? (runnerMode === "subagents" ? "available" : "not_loaded"),
    source_matrix: matrix,
    required_buckets: requiredBuckets,
    bucket_statuses: bucketStatuses,
    agent_runs: agentRuns,
    researcher_reports: researcherReports,
    searched_sources_table: researcherReports.flatMap((report) => report.sources_found),
    searched_but_no_signal: requiredBuckets.filter((bucket) => bucketStatuses[bucket] === "searched_but_no_signal"),
    codex_default_discovery_status: codexDefaultStatusFromRun(codexRun, codexDefaultDiscoveryStatus),
    codex_default_discovery_findings: {
      unexpected_source_buckets: defaultDiscoveryBuckets,
      followup_recommendations: defaultDiscoveryBuckets.map((bucket) => `Run follow-up search for ${bucket}.`)
    },
    useful_findings: [],
    conflicting_findings: [],
    source_gaps: requiredBuckets.filter((bucket) => bucketStatuses[bucket] !== "completed"),
    confidence_summary: runnerMode === "manual_fallback" ? "Manual fallback report; no live runner completed." : "Research runner completed with recorded bucket statuses.",
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
        continue;
      }
      results[index] = await runSdkBucket(task, cwd, matrix, entry, options);
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, sorted.length) }, () => worker()));
  return results.filter((result): result is { run: ResearchAgentRun; report: ResearcherReport } => result !== undefined);
}

export async function runResearch(task: string, cwd: string, options: RunResearchOptions = {}): Promise<ResearchReport> {
  const sourceRoot = options.sourceRoot ?? cwd;
  const parts = taskParts(task, options);
  const marker = createHookMarker({
    cwd,
    prompt: parts.rawUserPrompt,
    sourceRoot,
    taskType: "research-heavy",
    requiresSourceMatrix: true,
    requiresExecutorManifest: false,
    requiresValidation: false,
    input: options.input ?? {}
  });

  if (options.runnerMode === "manual_fallback") {
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "not_configured", {
      ...options,
      turnId: marker.turnId,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "manual_fallback",
      manualFallbackReason: options.manualFallbackReason ?? "Manual fallback explicitly requested.",
      subagentStatus: options.subagentStatus ?? "not_loaded"
    });
    const target = researchReportPath(cwd);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  if (!codexRunnerStatus().codexExportAvailable || !codexRunnerStatus().threadExportAvailable) {
    const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], "not_configured", {
      ...options,
      turnId: marker.turnId,
      rawUserPrompt: parts.rawUserPrompt,
      normalizedTask: parts.normalizedTask,
      runnerMode: "manual_fallback",
      manualFallbackReason: "Codex SDK runner is unavailable.",
      subagentStatus: "unavailable"
    });
    const target = researchReportPath(cwd);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  let matrix = sourceMatrixForTask(task, options);
  if (options.defaultDiscoveryBuckets?.length) {
    matrix = applyDefaultDiscoveryFindings(matrix, options.defaultDiscoveryBuckets);
  }
  const requiredEntries = matrix.entries.filter((entry) => entry.required);
  const results = await runBucketsWithConcurrency(task, cwd, matrix, requiredEntries, options);
  const agentRuns = results.map((result) => result.run);
  const researcherReports = results.map((result) => result.report);
  const requiredBuckets = requiredEntries.map((entry) => String(entry.bucket));
  const bucketStatuses = normalizeBucketStatuses(requiredBuckets, Object.fromEntries(agentRuns.map((run) => [run.bucket, bucketStatusFromRun(run)])));
  const codexRun = agentRuns.find((run) => run.bucket === "codex_default_discovery");
  const report = buildResearchReport(task, options.defaultDiscoveryBuckets ?? [], codexDefaultStatusFromRun(codexRun, "not_configured"), {
    ...options,
    turnId: marker.turnId,
    rawUserPrompt: parts.rawUserPrompt,
    normalizedTask: parts.normalizedTask,
    runnerMode: "sdk_threads",
    subagentStatus: "unavailable",
    agentRuns,
    bucketStatuses,
    researcherReports
  });
  const target = researchReportPath(cwd);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export interface ManualSourceInput {
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

function readResearchReport(cwd: string): ResearchReport {
  const target = researchReportPath(cwd);
  if (!existsSync(target)) throw new Error("research_report.json is missing; run codex-hardflow research first.");
  return JSON.parse(readFileSync(target, "utf8")) as ResearchReport;
}

function writeResearchReport(cwd: string, report: ResearchReport): ResearchReport {
  const target = researchReportPath(cwd);
  mkdirSync(dirname(target), { recursive: true });
  report.generatedAt = new Date().toISOString();
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return report;
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
  const report = readResearchReport(cwd);
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
  report.runner_mode = "mixed";
  report.bucket_statuses[input.bucket] = "manual_backfilled";
  report.searched_sources_table.push(source);
  upsertResearcherReport(report, source);
  upsertManualAgentRun(report, input.bucket, 1);
  if (input.finding) report.useful_findings.push(input.finding);
  if (input.citation) report.citations_or_refs.push(input.citation);
  else report.citations_or_refs.push(input.url_or_ref);
  report.source_gaps = report.source_gaps.filter((bucket) => bucket !== input.bucket);
  report.status = reportStatus(report.bucket_statuses, report.searched_sources_table);
  return writeResearchReport(cwd, report);
}

export function finalizeManualReport(cwd: string, updates: { usefulFindings?: string[]; conflictingFindings?: string[]; sourceGaps?: string[]; citationsOrRefs?: string[]; confidenceSummary?: string } = {}): ResearchReport {
  const report = readResearchReport(cwd);
  report.runner_mode = report.searched_sources_table.length > 0 ? "mixed" : report.runner_mode;
  if (updates.usefulFindings) report.useful_findings.push(...updates.usefulFindings);
  if (updates.conflictingFindings) report.conflicting_findings.push(...updates.conflictingFindings);
  if (updates.sourceGaps) report.source_gaps = updates.sourceGaps;
  if (updates.citationsOrRefs) report.citations_or_refs.push(...updates.citationsOrRefs);
  if (updates.confidenceSummary) report.confidence_summary = updates.confidenceSummary;
  report.status = reportStatus(report.bucket_statuses, report.searched_sources_table);
  return writeResearchReport(cwd, report);
}
