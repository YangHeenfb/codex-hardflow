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

function baseMetrics(report: ResearchReport): Omit<CoverageEvalResult, "coverage_score" | "coverage_claim" | "runId"> {
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
    subagentSpawnedCount: report.subagent_status === "spawned" ? report.agent_runs.filter((run) => !run.fallback_used).length : 0,
    manualBackfillCount: report.agent_runs.filter((run) => run.fallback_used || run.status === "manual_fallback").length,
    evidenceGatePassed: evidence.passed,
    criticalBucketsCovered,
    noSignalRecorded
  };
}

function score(metrics: Omit<CoverageEvalResult, "coverage_score" | "coverage_claim" | "runId">): number {
  const raw =
    metrics.bucketCoverageRatio * 35 +
    Math.min(metrics.uniqueSourceTypeCount, 5) * 5 +
    Math.min(metrics.primarySourceCount, 5) * 4 +
    (metrics.criticalBucketsCovered ? 15 : 0) +
    (metrics.codexDefaultDiscoveryPresent ? 10 : 0) +
    (metrics.noSignalRecorded ? 5 : 0) +
    (metrics.evidenceGatePassed ? 10 : 0);
  return Math.round(Math.min(100, raw));
}

export function evaluateCoverage(cwd: string, options: CoverageEvalOptions): CoverageEvalResult {
  const report = loadResearchReport(cwd, options.runId);
  const metrics = baseMetrics(report);
  const result: CoverageEvalResult = {
    runId: report.runId,
    ...metrics,
    coverage_score: score(metrics),
    coverage_claim: "hardflow coverage is broad by configured matrix"
  };
  if (options.baselineRunId) {
    const baseline = baseMetrics(loadResearchReport(cwd, options.baselineRunId));
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
