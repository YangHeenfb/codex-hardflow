import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_LOOP_CONFIG } from "../config.js";
import { executorManifestPath, researchReportPath, validationSummaryPath } from "../paths.js";
import type { CodexDefaultDiscoveryStatus, ResearchAgentRun, ResearchBucketStatus, ResearchReport, ResearcherReport, ValidationSummary } from "../schemas.js";
import { sanitizeText } from "../sanitizer.js";
import { incrementBlockCount, markerExpired, resolveCurrentMarker, updateMarker, type HookMarker } from "../hookState.js";
import { assertResearchReportEvidence } from "../researchOrchestrator.js";

type GateOutput = Record<string, unknown>;

function parseJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function blockOrAllow(marker: HookMarker, reason: string): GateOutput {
  if (marker.blockCount >= marker.maxBlocks) {
    return {
      decision: "allow",
      notice: `codex-hardflow gate failed after ${marker.blockCount} block(s): ${reason}`,
      hardflowStatus: "failed_max_blocks_reached",
      marker: { turnId: marker.turnId, promptHash: marker.promptHash, blockCount: marker.blockCount, maxBlocks: marker.maxBlocks }
    };
  }
  const next = incrementBlockCount(marker);
  return {
    decision: "block",
    reason,
    marker: { turnId: next.turnId, promptHash: next.promptHash, blockCount: next.blockCount, maxBlocks: next.maxBlocks }
  };
}

function reportForBucket(reports: ResearcherReport[], bucket: string): ResearcherReport | undefined {
  return reports.find((report) => report.bucket === bucket);
}

function validDiscoveryStatus(value: unknown): value is CodexDefaultDiscoveryStatus {
  return value === "completed" || value === "timeout" || value === "failed" || value === "not_configured";
}

function validBucketStatus(value: unknown): value is ResearchBucketStatus {
  return value === "completed" || value === "searched_but_no_signal" || value === "failed" || value === "timeout" || value === "manual_fallback" || value === "manual_backfilled" || value === "context_exhausted";
}

function runForBucket(runs: ResearchAgentRun[], bucket: string): ResearchAgentRun | undefined {
  return runs.find((run) => run.bucket === bucket || (bucket === "package_security" && (run.bucket === "package_registry" || run.bucket === "security")));
}

function bucketStatusHasRecord(report: ResearchReport, bucket: string, status: ResearchBucketStatus): boolean {
  const run = runForBucket(report.agent_runs ?? [], bucket);
  const bucketReport = reportForBucket(report.researcher_reports ?? [], bucket);
  const bucketSources = (report.searched_sources_table ?? []).filter((source) => source.bucket === bucket || (!source.bucket && bucketReport?.sources_found.includes(source)));
  if (status === "completed") return bucketSources.length > 0 || (bucketReport?.sources_found.length ?? 0) > 0;
  if (status === "manual_backfilled") return bucketSources.length > 0 || (bucketReport?.sources_found.length ?? 0) > 0;
  if (status === "searched_but_no_signal") return (run !== undefined || bucketReport !== undefined) && (run?.queries_run.length ?? bucketReport?.queries_run.length ?? 0) > 0;
  if (status === "timeout") return run?.status === "timeout" && run.failure_reason.length > 0;
  if (status === "failed" || status === "context_exhausted") return run !== undefined && run.failure_reason.length > 0;
  if (status === "manual_fallback") return (Boolean(report.manual_fallback_reason) || Boolean(run?.failure_reason)) && bucketSources.length > 0;
  return false;
}

function validateCurrentResearchReport(cwd: string, marker: HookMarker): { valid: boolean; reason?: string } {
  const path = researchReportPath(cwd);
  if (!existsSync(path)) return { valid: false, reason: "research_report.json is missing for this hardflow turn." };
  const report = parseJson<ResearchReport>(path);
  if (!report) return { valid: false, reason: "research_report.json is not valid JSON." };
  if (report.promptHash !== marker.promptHash) {
    return { valid: false, reason: "research_report.json promptHash does not match the current hardflow marker." };
  }
  if (!report.generatedAt || Date.parse(report.generatedAt) < Date.parse(marker.createdAt)) {
    return { valid: false, reason: "research_report.json was generated before the current hardflow marker." };
  }
  if (!report.source_matrix || !Array.isArray(report.source_matrix.entries)) {
    return { valid: false, reason: "research_report.json is missing source_matrix entries." };
  }
  if (!validDiscoveryStatus(report.codex_default_discovery_status)) {
    return { valid: false, reason: "research_report.json is missing codex_default_discovery_status." };
  }
  if (!Array.isArray(report.agent_runs)) {
    return { valid: false, reason: "research_report.json is missing agent_runs." };
  }
  if (typeof report.bucket_statuses !== "object" || report.bucket_statuses === null) {
    return { valid: false, reason: "research_report.json is missing bucket_statuses." };
  }
  if (report.subagent_status === "available" && report.runner_mode === "manual_fallback" && !report.agent_runs.some((run) => run.status !== "manual_fallback")) {
    return { valid: false, reason: "Subagent capability was available, but no subagents or SDK runner were used. Rerun with explicit subagents or SDK threads." };
  }
  const requiredBuckets = report.source_matrix.requiredBuckets?.length
    ? report.source_matrix.requiredBuckets
    : report.source_matrix.entries.filter((entry) => entry.required).map((entry) => String(entry.bucket));
  if (!requiredBuckets.includes("codex_default_discovery")) {
    return { valid: false, reason: "source_matrix must include required codex_default_discovery." };
  }
  const evidence = assertResearchReportEvidence(report, { researchHeavy: true });
  const appManualEvidenceMode = (report.runner_mode === "app_handoff" || report.runner_mode === "mixed") && (report.searched_sources_table ?? []).length > 0;
  if (!evidence.passed && report.runner_mode === "app_handoff" && !appManualEvidenceMode) {
    return { valid: false, reason: evidence.reason };
  }
  const missing = requiredBuckets.filter((bucket) => {
    const recordedStatus = report.bucket_statuses[bucket];
    if (validBucketStatus(recordedStatus) && bucketStatusHasRecord(report, bucket, recordedStatus)) return false;
    const entry = report.source_matrix.entries.find((item) => item.bucket === bucket);
    const researcherReport = reportForBucket(report.researcher_reports ?? [], bucket);
    const completed = Boolean((researcherReport?.sources_found?.length ?? 0) > 0 || entry?.searchedAtLeastOnce);
    const searchedButNoSignal = researcherReport?.searched_but_no_signal === true || entry?.searchedButNoSignal === true || report.searched_but_no_signal?.includes(bucket);
    return !(completed || searchedButNoSignal);
  });
  if (missing.length > 0) {
    if (appManualEvidenceMode) {
      const criticalMissing = missing.filter((bucket) => bucket === "official_docs" || bucket === "github" || bucket === "codex_default_discovery");
      if (criticalMissing.length === 0) {
        if (!evidence.passed) return { valid: false, reason: evidence.reason };
        return { valid: true };
      }
    }
    return { valid: false, reason: `source_matrix required buckets are not completed or searched-but-no-signal: ${missing.join(", ")}.` };
  }
  if (!evidence.passed) return { valid: false, reason: evidence.reason };
  return { valid: true };
}

export function stopValidationGate(input: Record<string, unknown> = {}): Record<string, unknown> {
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const marker = resolveCurrentMarker(input, cwd);
  if (!marker) return { decision: "allow" };

  if (markerExpired(marker)) {
    updateMarker(marker, { status: "expired" });
    return { decision: "allow", notice: "codex-hardflow marker expired; Stop gate allowed." };
  }
  if (marker.status === "completed" || marker.status === "expired") return { decision: "allow" };
  if (marker.bypass || marker.status === "bypassed") return { decision: "allow", notice: "codex-hardflow bypass marker allowed Stop." };
  if (marker.taskType === "hardflow-maintenance" && !marker.requiresValidation) {
    updateMarker(marker, { status: "completed" });
    return { decision: "allow", notice: "codex-hardflow maintenance marker does not require business executor_manifest.json." };
  }

  if (marker.requiresSourceMatrix) {
    const report = validateCurrentResearchReport(cwd, marker);
    if (!report.valid) return blockOrAllow(marker, report.reason ?? "research_report.json does not satisfy the current hardflow marker.");
  }

  if (marker.requiresExecutorManifest && !existsSync(executorManifestPath(cwd))) {
    return blockOrAllow(marker, "executor_manifest.json is missing for this implementation marker. Generate .agent/manifests/executor_manifest.json before stopping.");
  }

  if (!marker.requiresValidation) {
    updateMarker(marker, { status: "completed" });
    return { decision: "allow" };
  }

  if (!existsSync(validationSummaryPath(cwd))) {
    return blockOrAllow(marker, "validation_summary.json is missing for this validation-sensitive marker. Run codex-hardflow validate.");
  }

  const summary = parseJson<ValidationSummary>(validationSummaryPath(cwd));
  if (!summary) return blockOrAllow(marker, "validation_summary.json is not valid JSON.");
  if (summary.hidden_status === "failed") {
    const action = summary.iteration >= DEFAULT_LOOP_CONFIG.max_repair_cycles ? "stop" : "repair";
    return blockOrAllow(marker, action === "stop" ? "Max repair cycles reached; ask the user before continuing." : sanitizeText(summary.next_repair_prompt));
  }
  if (summary.hidden_status === "passed" && summary.final_holdout_status === "not_run") {
    return blockOrAllow(marker, "Hidden validation passed, but final holdout has not run. Run final holdout before stopping.");
  }
  if (summary.final_holdout_status === "failed") {
    return blockOrAllow(marker, summary.iteration >= DEFAULT_LOOP_CONFIG.max_repair_cycles ? "Final holdout failed after max repair cycles; ask the user before continuing." : "Final holdout failed. Continue repair loop using sanitized feedback.");
  }
  if (summary.hidden_status === "not_configured") {
    updateMarker(marker, { status: "completed" });
    return { decision: "allow", notice: "Hidden validator is not configured; do not claim hidden validation passed." };
  }
  updateMarker(marker, { status: "completed" });
  return { decision: "allow" };
}
