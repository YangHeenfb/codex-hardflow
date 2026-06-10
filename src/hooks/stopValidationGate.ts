import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_LOOP_CONFIG } from "../config.js";
import { currentResearchReportPath, executorManifestPath, legacyResearchReportPath, researchRunReportPath, validationSummaryPath } from "../paths.js";
import type { CodexDefaultDiscoveryStatus, ResearchAgentRun, ResearchBucketStatus, ResearchReport, ResearcherReport, ValidationSummary } from "../schemas.js";
import { sanitizeText } from "../sanitizer.js";
import { incrementBlockCount, markerExpired, resolveCurrentMarker, updateMarker, type HookMarker } from "../hookState.js";
import { appendHookEvent, assertHookActive } from "../hookEvents.js";
import { assertResearchReportEvidence } from "../researchOrchestrator.js";
import { readRouterTrace } from "../router/routerTrace.js";
import type { RouterOutput } from "../router/routerSchema.js";

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

function fallbackResearchReportPath(cwd: string): string | null {
  if (existsSync(currentResearchReportPath(cwd))) return currentResearchReportPath(cwd);
  if (existsSync(legacyResearchReportPath(cwd))) return legacyResearchReportPath(cwd);
  return null;
}

function validateCurrentPointer(cwd: string, report: ResearchReport): { valid: boolean; reason?: string } {
  const currentPath = currentResearchReportPath(cwd);
  if (!existsSync(currentPath)) return { valid: true };
  const current = parseJson<ResearchReport>(currentPath);
  if (!current) return { valid: false, reason: "current research_report.json is not valid JSON." };
  if (current.runId && current.runId !== report.runId) {
    return { valid: false, reason: "current research_report.json points to a different runId than the current hardflow marker." };
  }
  return { valid: true };
}

function validateCurrentResearchReport(cwd: string, marker: HookMarker): { valid: boolean; reason?: string } {
  const markerRunId = typeof marker.runId === "string" && marker.runId.length > 0 ? marker.runId : undefined;
  const path = markerRunId ? researchRunReportPath(cwd, markerRunId) : fallbackResearchReportPath(cwd);
  if (!markerRunId) {
    if (marker.blockCount > 0) {
      return { valid: false, reason: "hardflow marker is missing runId; rerun codex-hardflow research --runner app_handoff to create a run-owned report." };
    }
    if (!path) return { valid: false, reason: "hardflow marker is missing runId and no fallback research_report.json exists; rerun app_handoff research." };
  }
  if (!path) return { valid: false, reason: "research_report.json path could not be resolved for this hardflow marker." };
  if (!existsSync(path)) return { valid: false, reason: "research_report.json is missing for this hardflow turn." };
  const report = parseJson<ResearchReport>(path);
  if (!report) return { valid: false, reason: "research_report.json is not valid JSON." };
  if (markerRunId && report.runId !== markerRunId) {
    return { valid: false, reason: "research_report.json runId does not match the current hardflow marker." };
  }
  if (report.owner !== "parent") {
    return { valid: false, reason: "subagent-owned research_report cannot satisfy the parent Stop gate." };
  }
  if (report.parentRunId) {
    return { valid: false, reason: "subagent-only or child report cannot satisfy the parent Stop gate." };
  }
  if (report.promptHash !== marker.promptHash) {
    return { valid: false, reason: "research_report.json promptHash does not match the current hardflow marker." };
  }
  if (!report.generatedAt || Date.parse(report.generatedAt) < Date.parse(marker.createdAt)) {
    return { valid: false, reason: "research_report.json was generated before the current hardflow marker." };
  }
  if (report.programmaticTrigger !== true) {
    return { valid: false, reason: "research_report cannot claim hardflow completion because programmaticTrigger is not true." };
  }
  if (report.triggerSource === "agents_md_only" || report.triggerSource === "skill_only" || report.triggerSource === "unknown") {
    return { valid: false, reason: `research_report triggerSource=${report.triggerSource} cannot claim programmatic hardflow completion.` };
  }
  const active = assertHookActive(cwd, report.runId);
  if (!active.passed) {
    return { valid: false, reason: active.reason };
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
  const pointer = validateCurrentPointer(cwd, report);
  if (!pointer.valid) return pointer;
  if (report.subagent_status === "spawned" && report.subagent_trigger_source === "app_tool" && !report.agent_runs.some((run) => !run.fallback_used)) {
    return { valid: false, reason: "research_report claims subagents spawned, but no non-fallback subagent run was recorded." };
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

  function finish(result: Record<string, unknown>, reason?: string): Record<string, unknown> {
    appendHookEvent(cwd, {
      eventName: "Stop",
      runId: marker?.runId,
      turnId: marker?.turnId,
      promptHash: marker?.promptHash,
      triggerSource: marker?.triggerSource,
      programmaticTrigger: marker?.programmaticTrigger,
      decision: typeof result.decision === "string" ? result.decision : undefined,
      reason: reason ?? (typeof result.reason === "string" ? result.reason : typeof result.notice === "string" ? result.notice : undefined)
    });
    return result;
  }

  if (markerExpired(marker)) {
    updateMarker(marker, { status: "expired" });
    return finish({ decision: "allow", notice: "codex-hardflow marker expired; Stop gate allowed." });
  }
  if (marker.status === "completed" || marker.status === "expired") return finish({ decision: "allow" });
  if (marker.bypass || marker.status === "bypassed") return finish({ decision: "allow", notice: "codex-hardflow bypass marker allowed Stop." });
  if (marker.taskType === "hardflow-maintenance" && !marker.requiresValidation) {
    updateMarker(marker, { status: "completed" });
    return finish({ decision: "allow", notice: "codex-hardflow maintenance marker does not require business executor_manifest.json." });
  }

  const trace = readRouterTrace(cwd, marker.runId, marker.turnId);
  const routerOutput: RouterOutput | undefined = trace?.routerOutput;
  if (trace && (trace.owner ?? "parent") === "subagent" && (marker.requiresSourceMatrix || marker.requiresExecutorManifest || marker.requiresValidation)) {
    return finish(blockOrAllow(marker, "Parent router_trace is missing for this hardflow marker; a subagent router_trace cannot satisfy the parent Stop gate."));
  }
  if (!routerOutput && (marker.requiresSourceMatrix || marker.requiresExecutorManifest || marker.requiresValidation)) {
    return finish(blockOrAllow(marker, "router_trace/routerOutput is missing for this hardflow marker. Generate .agent/reports/runs/<runId>/router_trace.json; do not use keyword fallback."));
  }
  if (routerOutput?.route === "router_failed") {
    updateMarker(marker, { status: "completed" });
    return finish({ decision: "allow", notice: "Router failed; hardflow classification was not claimed. Ask for confirmation before code changes." });
  }
  if (routerOutput?.route === "bypass" || routerOutput?.bypass.requested) {
    updateMarker(marker, { status: "completed" });
    return finish({ decision: "allow", notice: "Router selected bypass; Stop gate allowed." });
  }

  const requiresSourceMatrix = routerOutput?.requiresSourceMatrix ?? marker.requiresSourceMatrix;
  const requiresExecutorManifest = routerOutput?.requiresExecutorManifest ?? marker.requiresExecutorManifest;
  const requiresValidation = routerOutput?.requiresValidation ?? marker.requiresValidation;
  const requiresFinalHoldout = routerOutput?.requiresFinalHoldout ?? false;

  if (requiresSourceMatrix) {
    const report = validateCurrentResearchReport(cwd, marker);
    if (!report.valid) return finish(blockOrAllow(marker, report.reason ?? "research_report.json does not satisfy the current hardflow marker."));
  }

  if (requiresExecutorManifest && !existsSync(executorManifestPath(cwd))) {
    return finish(blockOrAllow(marker, "executor_manifest.json is missing for this implementation marker. Generate .agent/manifests/executor_manifest.json before stopping."));
  }

  if (!requiresValidation && !requiresFinalHoldout) {
    updateMarker(marker, { status: "completed" });
    return finish({ decision: "allow" });
  }

  if (!existsSync(validationSummaryPath(cwd))) {
    return finish(blockOrAllow(marker, "validation_summary.json is missing for this validation-sensitive marker. Run codex-hardflow validate."));
  }

  const summary = parseJson<ValidationSummary>(validationSummaryPath(cwd));
  if (!summary) return finish(blockOrAllow(marker, "validation_summary.json is not valid JSON."));
  if (summary.hidden_status === "failed") {
    const action = summary.iteration >= DEFAULT_LOOP_CONFIG.max_repair_cycles ? "stop" : "repair";
    return finish(blockOrAllow(marker, action === "stop" ? "Max repair cycles reached; ask the user before continuing." : sanitizeText(summary.next_repair_prompt)));
  }
  if (summary.hidden_status === "passed" && summary.final_holdout_status === "not_run") {
    return finish(blockOrAllow(marker, "Hidden validation passed, but final holdout has not run. Run final holdout before stopping."));
  }
  if (requiresFinalHoldout && summary.hidden_status !== "not_configured" && summary.final_holdout_status !== "passed") {
    return finish(blockOrAllow(marker, "Router requires final holdout, but final_holdout_status is not passed."));
  }
  if (summary.final_holdout_status === "failed") {
    return finish(blockOrAllow(marker, summary.iteration >= DEFAULT_LOOP_CONFIG.max_repair_cycles ? "Final holdout failed after max repair cycles; ask the user before continuing." : "Final holdout failed. Continue repair loop using sanitized feedback."));
  }
  if (summary.hidden_status === "not_configured") {
    updateMarker(marker, { status: "completed" });
    return finish({ decision: "allow", notice: "Hidden validator is not configured; do not claim hidden validation passed." });
  }
  updateMarker(marker, { status: "completed" });
  return finish({ decision: "allow" });
}
