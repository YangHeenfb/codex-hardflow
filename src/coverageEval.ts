import { maybeLoadCoveragePlan, type CoveragePlan } from "./coverage/coveragePlan.js";
import { hasEvidenceForRequiredBuckets, isNoSignalEvidence, loadEvidenceLedger, type EvidenceItem } from "./coverage/evidenceLedger.js";
import { assertResearchReportEvidence, loadResearchReport } from "./researchOrchestrator.js";
import type { ResearchReport, ResearchSource } from "./schemas.js";

export interface CoverageEvalOptions {
  runId: string;
  baselineRunId?: string;
}

export interface CoverageEvalResult {
  runId: string;
  requiredBucketCount: number;
  completedBucketCount: number;
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
  noSignalRecords: number;
  subagentSpawnedCount: number;
  manualBackfillCount: number;
  evidenceGatePassed: boolean;
  criticalBucketsCovered: boolean;
  noSignalRecorded: boolean;
  coverage_score: number;
  coverage_claim: string;
  baselineRunId?: string;
  baselineSourceCount?: number;
  baselineSourceTypeCount?: number;
  baselineBucketCoverageRatio?: number;
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

type CoverageMetrics = Omit<CoverageEvalResult, "coverage_score" | "coverage_claim" | "runId">;

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
    requiredBucketCount: requiredBuckets.length,
    completedBucketCount,
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
    noSignalRecords: report.searched_but_no_signal?.length ?? 0,
    subagentSpawnedCount: report.subagent_status === "spawned" ? report.agent_runs.filter((run) => !run.fallback_used).length : 0,
    manualBackfillCount: report.agent_runs.filter((run) => run.fallback_used || run.status === "manual_fallback").length,
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
  const requiredQuestions = plan.researchQuestions.filter((question) => question.priority !== "optional");
  const requiredPerspectives = plan.perspectives.filter((perspective) => perspective.required);
  const coveredQuestions = requiredQuestions.filter((question) => questionCovered(question, items));
  const coveredPerspectives = requiredPerspectives.filter((perspective) => perspectiveCovered(perspective, plan, items));
  const noSignalRecords = items.filter(isNoSignalEvidence).length;
  const criticalBuckets = plan.sourceBuckets.filter((bucket) => bucket.priority === "critical" && bucket.required).map((bucket) => bucket.bucket);
  const criticalBucketsCovered = criticalBuckets.every((bucket) => items.some((item) => item.bucket === bucket));

  return {
    requiredBucketCount: requiredBuckets.length,
    completedBucketCount,
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
    noSignalRecords,
    subagentSpawnedCount: report?.subagent_status === "spawned" ? report.agent_runs.filter((run) => !run.fallback_used).length : 0,
    manualBackfillCount: countEvidence(items, (item) => item.engine === "manual_backfill"),
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
  const { runId, metrics } = metricsForRun(cwd, options.runId);
  const result: CoverageEvalResult = {
    runId,
    ...metrics,
    coverage_score: score(metrics),
    coverage_claim: "hardflow coverage is broad by configured matrix"
  };
  if (options.baselineRunId) {
    const baseline = metricsForRun(cwd, options.baselineRunId).metrics;
    result.baselineRunId = options.baselineRunId;
    result.baselineSourceCount = baseline.uniqueSourceCount;
    result.baselineSourceTypeCount = baseline.uniqueSourceTypeCount;
    result.baselineBucketCoverageRatio = baseline.bucketCoverageRatio;
    result.coverage_claim =
      result.uniqueSourceCount > baseline.uniqueSourceCount && result.uniqueSourceTypeCount >= baseline.uniqueSourceTypeCount
        ? "hardflow coverage exceeded the supplied baseline on source count and matched or exceeded source type diversity"
        : "hardflow coverage was evaluated against the supplied baseline";
  }
  return result;
}
