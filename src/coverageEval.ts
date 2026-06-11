import { existsSync, readdirSync, readFileSync } from "node:fs";
import { maybeLoadCoveragePlan, type CoveragePlan } from "./coverage/coveragePlan.js";
import { hasEvidenceForRequiredBuckets, isNoSignalEvidence, loadEvidenceLedger, type EvidenceItem } from "./coverage/evidenceLedger.js";
import { researchRunEvidenceLedgerPath, researchRunReportPath, researchRunsDir } from "./paths.js";
import { assertResearchReportEvidence, loadResearchReport } from "./researchOrchestrator.js";
import type { CoverageMode, ExcludedBucket, ResearchReport, ResearchSource } from "./schemas.js";

export interface CoverageEvalOptions {
  runId?: string;
  baselineRunId?: string;
  latestEvidenceRun?: boolean;
  includeTestRuns?: boolean;
}

export interface CoverageEvalResult {
  runId: string;
  selectedRunId: string;
  selectedRunReason: string;
  coverageMode?: CoverageMode;
  requiredBucketCount: number;
  completedBucketCount: number;
  completedOrBackfilledBucketCount: number;
  completedRequiredBucketCount: number;
  bucketCoverageRatio: number;
  questionCoverageRatio: number;
  perspectiveCoverageRatio: number;
  engineDiversity: number;
  uniqueSourceCount: number;
  uniqueSourceTypeCount: number;
  primarySourceCount: number;
  communityWeakSignalCount: number;
  githubSourceCount: number;
  academicSourceCount: number;
  securitySourceCount: number;
  packageRegistrySourceCount: number;
  localRepoSourceCount: number;
  codexDefaultDiscoveryPresent: boolean;
  searchedButNoSignalCount: number;
  excludedBucketCount: number;
  excludedBuckets: ExcludedBucket[];
  skippedPossibleBuckets: string[];
  coverageDebt: string[];
  noSignalRecords: number;
  subagentSpawnedCount: number;
  manualBackfillCount: number;
  programmaticTrigger: boolean;
  programmaticMultiAgent: boolean;
  evidenceGatePassed: boolean;
  criticalBucketsCovered: boolean;
  noSignalRecorded: boolean;
  coverage_score: number;
  coverage_claim: string;
  baselinePresent: boolean;
  broaderThanDefaultClaimAllowed: boolean;
  baselineRunId?: string;
  baselineSourceCount?: number;
  baselineSourceTypeCount?: number;
  baselineBucketCoverageRatio?: number;
  baselineCoverageScore?: number;
  deltaBucketCoverageRatio?: number;
  deltaUniqueSourceTypeCount?: number;
  deltaPrimarySourceCount?: number;
  deltaCoverageScore?: number;
  deltaSourceCount?: number;
}

function uniqueSourceKey(source: ResearchSource): string {
  return `${source.source_type}\u0000${source.url_or_ref}\u0000${source.title}`;
}

function sourceType(source: ResearchSource): string {
  return source.source_type.toLowerCase();
}

function sourceBucket(source: ResearchSource): string {
  return (source.bucket ?? "").toLowerCase();
}

function countSources(sources: ResearchSource[], predicate: (source: ResearchSource) => boolean): number {
  return sources.filter(predicate).length;
}

function completedStatus(status: string | undefined): boolean {
  return status === "completed" || status === "manual_backfilled" || status === "searched_but_no_signal";
}

type CoverageMetrics = Omit<
  CoverageEvalResult,
  | "coverage_score"
  | "coverage_claim"
  | "runId"
  | "selectedRunId"
  | "selectedRunReason"
  | "baselinePresent"
  | "broaderThanDefaultClaimAllowed"
  | "baselineRunId"
  | "baselineSourceCount"
  | "baselineSourceTypeCount"
  | "baselineBucketCoverageRatio"
  | "baselineCoverageScore"
  | "deltaBucketCoverageRatio"
  | "deltaUniqueSourceTypeCount"
  | "deltaPrimarySourceCount"
  | "deltaCoverageScore"
  | "deltaSourceCount"
>;

function baseMetrics(report: ResearchReport): CoverageMetrics {
  const requiredBuckets = report.required_buckets.length > 0 ? report.required_buckets : report.source_matrix.requiredBuckets;
  const completedBucketCount = requiredBuckets.filter((bucket) => completedStatus(report.bucket_statuses[bucket])).length;
  const sources = report.searched_sources_table ?? [];
  const sourceTypes = new Set(sources.map((source) => source.source_type));
  const uniqueSources = new Set(sources.map(uniqueSourceKey));
  const evidence = assertResearchReportEvidence(report, { researchHeavy: true });
  const criticalBuckets = ["official_docs", "github", "codex_default_discovery"].filter((bucket) => requiredBuckets.includes(bucket));
  const criticalBucketsCovered = criticalBuckets.every((bucket) => completedStatus(report.bucket_statuses[bucket]));
  const noSignalRecorded = (report.searched_but_no_signal ?? []).length > 0 || Object.values(report.bucket_statuses).includes("searched_but_no_signal");

  return {
    coverageMode: report.coverageMode ?? report.source_matrix.coverageMode,
    requiredBucketCount: requiredBuckets.length,
    completedBucketCount,
    completedOrBackfilledBucketCount: completedBucketCount,
    completedRequiredBucketCount: completedBucketCount,
    bucketCoverageRatio: requiredBuckets.length === 0 ? 0 : completedBucketCount / requiredBuckets.length,
    questionCoverageRatio: 0,
    perspectiveCoverageRatio: 0,
    engineDiversity: sourceTypes.size,
    uniqueSourceCount: uniqueSources.size,
    uniqueSourceTypeCount: sourceTypes.size,
    primarySourceCount: countSources(sources, (source) => ["official_docs", "official", "vendor_docs", "docs", "package_registry", "security_advisory"].includes(sourceType(source))),
    communityWeakSignalCount: countSources(sources, (source) => sourceBucket(source) === "community" || sourceType(source).includes("community") || sourceType(source).includes("forum")),
    githubSourceCount: countSources(sources, (source) => sourceBucket(source) === "github" || sourceType(source).includes("github")),
    academicSourceCount: countSources(sources, (source) => sourceBucket(source) === "academic" || sourceType(source).includes("academic") || sourceType(source).includes("paper")),
    securitySourceCount: countSources(sources, (source) => sourceBucket(source) === "security" || sourceType(source).includes("security") || sourceType(source).includes("cve")),
    packageRegistrySourceCount: countSources(sources, (source) => sourceBucket(source) === "package_registry" || sourceType(source).includes("package")),
    localRepoSourceCount: countSources(sources, (source) => sourceBucket(source) === "local_repo" || sourceType(source).includes("local")),
    codexDefaultDiscoveryPresent: requiredBuckets.includes("codex_default_discovery") && completedStatus(report.bucket_statuses.codex_default_discovery),
    searchedButNoSignalCount: report.searched_but_no_signal?.length ?? 0,
    excludedBucketCount: report.excludedBucketCount ?? report.excludedBuckets?.length ?? report.source_matrix.excludedBuckets?.length ?? 0,
    excludedBuckets: report.excludedBuckets ?? report.source_matrix.excludedBuckets ?? [],
    skippedPossibleBuckets: report.skippedPossibleBuckets ?? report.source_matrix.skippedPossibleBuckets ?? [],
    coverageDebt: report.coverageDebt ?? report.source_matrix.coverageDebt ?? [],
    noSignalRecords: report.searched_but_no_signal?.length ?? 0,
    subagentSpawnedCount: report.subagent_status === "spawned" ? report.agent_runs.filter((run) => !run.fallback_used).length : 0,
    manualBackfillCount: report.agent_runs.filter((run) => run.fallback_used || run.status === "manual_fallback").length,
    programmaticTrigger: report.programmaticTrigger === true,
    programmaticMultiAgent: report.programmaticMultiAgent === true,
    evidenceGatePassed: evidence.passed,
    criticalBucketsCovered,
    noSignalRecorded
  };
}

function evidenceSourceKey(item: EvidenceItem): string {
  return `${item.sourceType}\u0000${item.urlOrRef}\u0000${item.title}`;
}

function evidenceSourceType(item: EvidenceItem): string {
  return item.sourceType.toLowerCase();
}

function evidenceBucket(item: EvidenceItem): string {
  return item.bucket.toLowerCase();
}

function countEvidence(items: EvidenceItem[], predicate: (item: EvidenceItem) => boolean): number {
  return items.filter(predicate).length;
}

function questionCovered(question: CoveragePlan["researchQuestions"][number], items: EvidenceItem[]): boolean {
  return items.some((item) => item.researchQuestionId === question.id || item.bucket === question.bucket);
}

function perspectiveCovered(perspective: CoveragePlan["perspectives"][number], plan: CoveragePlan, items: EvidenceItem[]): boolean {
  const perspectiveBuckets = new Set(plan.researchQuestions.filter((question) => question.perspectiveId === perspective.id).map((question) => question.bucket));
  return items.some((item) => item.perspectiveId === perspective.id || perspectiveBuckets.has(item.bucket));
}

function planLedgerMetrics(plan: CoveragePlan, items: EvidenceItem[], report?: ResearchReport): CoverageMetrics {
  const requiredBuckets = plan.sourceBuckets.filter((bucket) => bucket.required).map((bucket) => bucket.bucket);
  const coverage = hasEvidenceForRequiredBuckets(plan, items);
  const completedBucketCount = coverage.coveredBuckets.length;
  const sourceItems = items.filter((item) => !isNoSignalEvidence(item));
  const uniqueSources = new Set(sourceItems.map(evidenceSourceKey));
  const sourceTypes = new Set(sourceItems.map((item) => item.sourceType));
  const engines = new Set(items.map((item) => item.engine));
  const requiredBucketSet = new Set(requiredBuckets);
  const requiredQuestions = plan.researchQuestions.filter((question) => requiredBucketSet.has(question.bucket));
  const requiredPerspectives = plan.perspectives.filter((perspective) => perspective.required);
  const coveredQuestions = requiredQuestions.filter((question) => questionCovered(question, items));
  const coveredPerspectives = requiredPerspectives.filter((perspective) => perspectiveCovered(perspective, plan, items));
  const noSignalRecords = items.filter(isNoSignalEvidence).length;
  const criticalBuckets = plan.sourceBuckets.filter((bucket) => bucket.priority === "critical" && bucket.required).map((bucket) => bucket.bucket);
  const criticalBucketsCovered = criticalBuckets.every((bucket) => items.some((item) => item.bucket === bucket));

  return {
    coverageMode: plan.coverageMode,
    requiredBucketCount: requiredBuckets.length,
    completedBucketCount,
    completedOrBackfilledBucketCount: completedBucketCount,
    completedRequiredBucketCount: completedBucketCount,
    bucketCoverageRatio: requiredBuckets.length === 0 ? 0 : completedBucketCount / requiredBuckets.length,
    questionCoverageRatio: requiredQuestions.length === 0 ? 0 : coveredQuestions.length / requiredQuestions.length,
    perspectiveCoverageRatio: requiredPerspectives.length === 0 ? 0 : coveredPerspectives.length / requiredPerspectives.length,
    engineDiversity: engines.size,
    uniqueSourceCount: uniqueSources.size,
    uniqueSourceTypeCount: sourceTypes.size,
    primarySourceCount: countEvidence(sourceItems, (item) =>
      ["official_docs", "official", "vendor_docs", "docs", "package_registry", "security_advisory", "local_repo"].includes(evidenceSourceType(item))
    ),
    communityWeakSignalCount: countEvidence(sourceItems, (item) => evidenceBucket(item) === "community" || evidenceSourceType(item).includes("community") || evidenceSourceType(item).includes("forum")),
    githubSourceCount: countEvidence(sourceItems, (item) => evidenceBucket(item) === "github" || evidenceSourceType(item).includes("github")),
    academicSourceCount: countEvidence(sourceItems, (item) => evidenceBucket(item) === "academic" || evidenceSourceType(item).includes("academic") || evidenceSourceType(item).includes("paper")),
    securitySourceCount: countEvidence(sourceItems, (item) => evidenceBucket(item) === "security" || evidenceSourceType(item).includes("security") || evidenceSourceType(item).includes("cve")),
    packageRegistrySourceCount: countEvidence(sourceItems, (item) => evidenceBucket(item) === "package_registry" || evidenceSourceType(item).includes("package")),
    localRepoSourceCount: countEvidence(sourceItems, (item) => evidenceBucket(item) === "local_repo" || evidenceSourceType(item).includes("local")),
    codexDefaultDiscoveryPresent: items.some((item) => item.bucket === "codex_default_discovery"),
    searchedButNoSignalCount: noSignalRecords,
    excludedBucketCount: plan.excludedBuckets?.length ?? 0,
    excludedBuckets: plan.excludedBuckets ?? [],
    skippedPossibleBuckets: plan.skippedPossibleBuckets ?? [],
    coverageDebt: plan.coverageDebt ?? [],
    noSignalRecords,
    subagentSpawnedCount: report?.subagent_status === "spawned" ? report.agent_runs.filter((run) => !run.fallback_used).length : 0,
    manualBackfillCount: countEvidence(items, (item) => item.engine === "manual_backfill"),
    programmaticTrigger: report?.programmaticTrigger === true,
    programmaticMultiAgent: report?.programmaticMultiAgent === true,
    evidenceGatePassed: coverage.passed,
    criticalBucketsCovered,
    noSignalRecorded: noSignalRecords > 0
  };
}

function score(metrics: CoverageMetrics): number {
  const raw =
    metrics.bucketCoverageRatio * 35 +
    Math.min(metrics.uniqueSourceTypeCount, 5) * 5 +
    Math.min(metrics.primarySourceCount, 5) * 4 +
    Math.min(metrics.questionCoverageRatio, 1) * 5 +
    Math.min(metrics.perspectiveCoverageRatio, 1) * 5 +
    Math.min(metrics.engineDiversity, 5) * 2 +
    (metrics.criticalBucketsCovered ? 15 : 0) +
    (metrics.codexDefaultDiscoveryPresent ? 10 : 0) +
    (metrics.noSignalRecorded ? 5 : 0) +
    (metrics.evidenceGatePassed ? 10 : 0);
  return Math.round(Math.min(100, raw));
}

const TEST_RUN_PATTERNS = ["plumbing", "flag-test", "hook-audit", "injection-check", "subagent-audit", "coverage-audit", "router-only", "dry-run", "test"];

function excludedTestRun(runId: string): boolean {
  const lowered = runId.toLowerCase();
  return TEST_RUN_PATTERNS.some((pattern) => lowered.includes(pattern));
}

function readRunReport(cwd: string, runId: string): ResearchReport | undefined {
  const target = researchRunReportPath(cwd, runId);
  if (!existsSync(target)) return undefined;
  try {
    return JSON.parse(readFileSync(target, "utf8")) as ResearchReport;
  } catch {
    return undefined;
  }
}

function ledgerItemCount(cwd: string, runId: string): { count: number; updatedAt?: string } {
  const target = researchRunEvidenceLedgerPath(cwd, runId);
  if (!existsSync(target)) return { count: 0 };
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as { updatedAt?: string; items?: unknown[] };
    return { count: Array.isArray(parsed.items) ? parsed.items.length : 0, updatedAt: parsed.updatedAt };
  } catch {
    return { count: 0 };
  }
}

function sortableTime(report: ResearchReport, ledgerUpdatedAt?: string): number {
  const times = [report.generatedAt, report.currentPointerUpdatedAt, ledgerUpdatedAt]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.max(...times) : 0;
}

interface RunSelection {
  runId: string;
  reason: string;
}

export function selectCoverageRun(cwd: string, options: Pick<CoverageEvalOptions, "includeTestRuns"> = {}): RunSelection {
  const runsDir = researchRunsDir(cwd);
  if (!existsSync(runsDir)) throw new Error("No evidence-bearing parent research run found; pass --run-id.");
  const candidates: Array<{ runId: string; report: ResearchReport; ledgerCount: number; time: number }> = [];
  for (const dirent of readdirSync(runsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const runId = dirent.name;
    if (!options.includeTestRuns && excludedTestRun(runId)) continue;
    const report = readRunReport(cwd, runId);
    if (!report) continue;
    if (report.owner && report.owner !== "parent") continue;
    if (report.status !== "completed" && report.status !== "degraded") continue;
    const plan = maybeLoadCoveragePlan(cwd, runId);
    if (!report.source_matrix && !plan) continue;
    const ledger = ledgerItemCount(cwd, runId);
    const sourceCount = Array.isArray(report.searched_sources_table) ? report.searched_sources_table.length : 0;
    if (sourceCount === 0 && ledger.count === 0) continue;
    candidates.push({ runId, report, ledgerCount: ledger.count, time: sortableTime(report, ledger.updatedAt) });
  }
  candidates.sort((a, b) => b.time - a.time || b.ledgerCount - a.ledgerCount || b.runId.localeCompare(a.runId));
  const selected = candidates[0];
  if (!selected) throw new Error("No evidence-bearing parent research run found; pass --run-id.");
  return {
    runId: selected.runId,
    reason: `selected latest evidence-bearing parent run (${selected.report.searched_sources_table?.length ?? 0} report sources, ${selected.ledgerCount} ledger items)`
  };
}

function metricsForRun(cwd: string, runId: string): { runId: string; metrics: CoverageMetrics } {
  const plan = maybeLoadCoveragePlan(cwd, runId);
  if (plan) {
    const ledger = loadEvidenceLedger(cwd, runId);
    let report: ResearchReport | undefined;
    try {
      report = loadResearchReport(cwd, runId);
    } catch {
      report = undefined;
    }
    return { runId: plan.runId, metrics: planLedgerMetrics(plan, ledger.items, report) };
  }
  const report = loadResearchReport(cwd, runId);
  return { runId: report.runId, metrics: baseMetrics(report) };
}

export function evaluateCoverage(cwd: string, options: CoverageEvalOptions): CoverageEvalResult {
  const selection = options.runId
    ? { runId: options.runId, reason: "explicit --run-id" }
    : selectCoverageRun(cwd, { includeTestRuns: options.includeTestRuns });
  const { runId, metrics } = metricsForRun(cwd, selection.runId);
  const coverageScore = score(metrics);
  const result: CoverageEvalResult = {
    runId,
    selectedRunId: runId,
    selectedRunReason: selection.reason,
    ...metrics,
    coverage_score: coverageScore,
    coverage_claim:
      metrics.coverageMode === "exhaustive" && metrics.bucketCoverageRatio === 1
        ? "exhaustive hardflow covered all configured required buckets"
        : "hardflow coverage is broad by configured matrix",
    baselinePresent: false,
    broaderThanDefaultClaimAllowed: false
  };
  if (options.baselineRunId) {
    const baseline = metricsForRun(cwd, options.baselineRunId).metrics;
    const baselineCoverageScore = score(baseline);
    result.baselineRunId = options.baselineRunId;
    result.baselineSourceCount = baseline.uniqueSourceCount;
    result.baselineSourceTypeCount = baseline.uniqueSourceTypeCount;
    result.baselineBucketCoverageRatio = baseline.bucketCoverageRatio;
    result.baselineCoverageScore = baselineCoverageScore;
    result.baselinePresent = baseline.uniqueSourceCount > 0 || baseline.completedBucketCount > 0;
    result.broaderThanDefaultClaimAllowed = result.baselinePresent;
    result.deltaBucketCoverageRatio = result.bucketCoverageRatio - baseline.bucketCoverageRatio;
    result.deltaUniqueSourceTypeCount = result.uniqueSourceTypeCount - baseline.uniqueSourceTypeCount;
    result.deltaPrimarySourceCount = result.primarySourceCount - baseline.primarySourceCount;
    result.deltaCoverageScore = result.coverage_score - baselineCoverageScore;
    result.deltaSourceCount = result.uniqueSourceCount - baseline.uniqueSourceCount;
    result.coverage_claim =
      result.broaderThanDefaultClaimAllowed && result.uniqueSourceCount > baseline.uniqueSourceCount && result.uniqueSourceTypeCount >= baseline.uniqueSourceTypeCount
        ? "hardflow coverage exceeded the supplied baseline on source count and matched or exceeded source type diversity"
        : "hardflow coverage was evaluated against the supplied baseline";
  }
  return result;
}
