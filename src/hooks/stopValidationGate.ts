import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_LOOP_CONFIG, DEFAULT_TRIGGER_RUNTIME_CONFIG, type TriggerRuntimeConfig } from "../config.js";
import { currentResearchReportPath, executorManifestPath, legacyResearchReportPath, researchRunReportPath, validationSummaryPath } from "../paths.js";
import type { CodexDefaultDiscoveryStatus, ResearchAgentRun, ResearchBucketStatus, ResearchReport, ResearcherReport, ValidationSummary } from "../schemas.js";
import { sanitizeText } from "../sanitizer.js";
import { incrementBlockCount, markerExpired, resolveCurrentMarker, updateMarker, type HookMarker } from "../hookState.js";
import { appendHookEvent, assertHookActive } from "../hookEvents.js";
import { assertResearchReportEvidence } from "../researchOrchestrator.js";
import { listEvidence } from "../coverage/evidenceLedger.js";
import { blockingResearchRequests, failedBlockingResearchRequests, listResearchRequests } from "../research/researchRequest.js";
import { readRouterTrace } from "../router/routerTrace.js";
import type { RouterOutput } from "../router/routerSchema.js";
import { defaultRoutePreflightRunner, defaultStrictResearchRunner, type RoutePreflightRunner, type StrictResearchRunner } from "./hookAutomation.js";

type GateOutput = Record<string, unknown>;

export interface StopValidationGateOptions {
  routeRunner?: RoutePreflightRunner;
  strictResearchRunner?: StrictResearchRunner;
  config?: Partial<TriggerRuntimeConfig>;
}

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

function hardBlock(marker: HookMarker, reason: string, hardflowStatus = "strict_research_required"): GateOutput {
  const next = incrementBlockCount(marker);
  return {
    decision: "block",
    reason,
    hardflowStatus,
    marker: { turnId: next.turnId, promptHash: next.promptHash, blockCount: next.blockCount, maxBlocks: next.maxBlocks }
  };
}

function configWithDefaults(config: Partial<TriggerRuntimeConfig> | undefined): TriggerRuntimeConfig {
  return { ...DEFAULT_TRIGGER_RUNTIME_CONFIG, ...(config ?? {}) };
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

function currentReportForMarker(cwd: string, marker: HookMarker): { report?: ResearchReport; reason?: string } {
  const markerRunId = typeof marker.runId === "string" && marker.runId.length > 0 ? marker.runId : undefined;
  const path = markerRunId ? researchRunReportPath(cwd, markerRunId) : fallbackResearchReportPath(cwd);
  if (!path) return { reason: "research_report.json path could not be resolved for this hardflow marker." };
  if (!existsSync(path)) return { reason: "research_report.json is missing for this hardflow turn." };
  const report = parseJson<ResearchReport>(path);
  if (!report) return { reason: "research_report.json is not valid JSON." };
  return { report };
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

type ExecutorManifestResearchFields = {
  externalResearchNeeded?: boolean;
  unresolvedResearchRequests?: string[];
};

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
    if (appManualEvidenceMode && report.coverageMode !== "exhaustive") {
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

function validateAutomaticStrictResearchArtifacts(cwd: string, report: ResearchReport): { valid: boolean; reason?: string } {
  if (report.runner_mode !== "strict_programmatic" && report.runner_mode !== "sdk_threads") {
    return { valid: false, reason: `route=research requires strict_programmatic/sdk_threads research; runner_mode=${report.runner_mode} cannot satisfy it.` };
  }
  if (report.coverageMode !== "exhaustive") {
    return { valid: false, reason: `route=research requires coverageMode=exhaustive; coverageMode=${report.coverageMode ?? "missing"} cannot satisfy it.` };
  }
  if (report.parallelPolicy !== "all_required") {
    return { valid: false, reason: `route=research requires parallelPolicy=all_required; parallelPolicy=${report.parallelPolicy ?? "missing"} cannot satisfy it.` };
  }
  if (report.programmaticMultiAgent !== true) {
    return { valid: false, reason: "route=research requires programmaticMultiAgent=true from SDK workers." };
  }
  if (!Array.isArray(report.sdk_worker_runs) || report.sdk_worker_runs.length === 0) {
    return { valid: false, reason: "route=research requires non-empty sdk_worker_runs; ordinary web search or manual notes cannot satisfy it." };
  }
  if (listEvidence(cwd, report.runId).length === 0) {
    return { valid: false, reason: "route=research requires a non-empty EvidenceLedger; ordinary web search without EvidenceLedger cannot satisfy it." };
  }
  return { valid: true };
}

export function stopValidationGate(input: Record<string, unknown> = {}, options: StopValidationGateOptions = {}): Record<string, unknown> {
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const resolvedMarker = resolveCurrentMarker(input, cwd);
  if (!resolvedMarker) return { decision: "allow" };
  let marker: HookMarker = resolvedMarker;
  const config = configWithDefaults(options.config);

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

  function rawPromptForMarker(): string | undefined {
    if (typeof marker?.rawUserPrompt === "string" && marker.rawUserPrompt.trim().length > 0) return marker.rawUserPrompt;
    if (typeof input.prompt === "string" && input.prompt.trim().length > 0) return input.prompt;
    if (typeof input.user_prompt === "string" && input.user_prompt.trim().length > 0) return input.user_prompt;
    if (typeof input.message === "string" && input.message.trim().length > 0) return input.message;
    return undefined;
  }

  function autoRouteFallback(reason: string): { ok: boolean; routerOutput?: RouterOutput; reason?: string } {
    if (!config.stopAutoRouteFallback) return { ok: false, reason };
    if (marker.stopAutoRouteAttempted) return { ok: false, reason: `${reason} Stop auto-route fallback was already attempted and did not produce a usable router_trace.` };
    const rawUserPrompt = rawPromptForMarker();
    if (!rawUserPrompt) return { ok: false, reason: `${reason} Cannot retry route because the raw user prompt is unavailable.` };
    const routeRunner = options.routeRunner ?? defaultRoutePreflightRunner;
    marker = updateMarker(marker, { stopAutoRouteAttempted: true });
    const result = routeRunner({
      cwd,
      command: marker.absoluteCommand,
      runId: marker.runId,
      rawUserPrompt,
      timeoutMs: config.routePreflightTimeoutMs
    });
    marker = updateMarker(marker, {
      routeStatus: result.succeeded ? "routed" : "router_failed",
      routerTracePath: result.tracePath,
      routerRoute: result.trace?.route,
      routerPreflightSource: "stop_hook",
      routerPreflightSucceeded: result.succeeded,
      routerPreflightFailureReason: result.succeeded ? undefined : result.failureReason,
      routerPreflightCompletedAt: new Date().toISOString(),
      stopAutoRouteFailureReason: result.succeeded ? undefined : result.failureReason
    });
    if (!result.succeeded || !result.trace?.routerOutput) {
      return { ok: false, reason: result.failureReason ?? "Stop auto-route fallback did not produce routerOutput." };
    }
    return { ok: true, routerOutput: result.trace.routerOutput };
  }

  function autoRunStrictResearch(): { ok: boolean; reason?: string } {
    if (!config.autoRunStrictResearchInStop) return { ok: false, reason: "Stop auto-run strict research is disabled." };
    if (marker.strictResearchStopAttempted && !marker.strictResearchAutoRunCompletedAt) {
      return { ok: false, reason: marker.strictResearchStopFailureReason ?? "Stop strict research auto-run was already attempted and failed." };
    }
    const rawUserPrompt = rawPromptForMarker();
    if (!rawUserPrompt) return { ok: false, reason: "Cannot run strict research because the raw user prompt is unavailable." };
    const strictRunner = options.strictResearchRunner ?? defaultStrictResearchRunner;
    marker = updateMarker(marker, { strictResearchStopAttempted: true });
    const result = strictRunner({
      cwd,
      command: marker.absoluteCommand,
      runId: marker.runId,
      rawUserPrompt,
      timeoutMs: config.strictResearchStopTimeoutMs
    });
    if (!result.succeeded) {
      marker = updateMarker(marker, { strictResearchStopFailureReason: result.failureReason ?? "strict research failed without a failure reason." });
      return { ok: false, reason: result.failureReason ?? "strict research failed without a failure reason." };
    }
    marker = updateMarker(marker, {
      strictResearchStopFailureReason: undefined,
      strictResearchAutoRunCompletedAt: new Date().toISOString()
    });
    return { ok: true };
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

  let trace = readRouterTrace(cwd, marker.runId, marker.turnId);
  let routerOutput: RouterOutput | undefined = trace?.routerOutput;
  if (marker.routeStatus === "router_failed") {
    if (config.allowQuickAnswerBypass && input.allowQuickAnswerBypass === true) {
      marker = updateMarker(marker, { status: "completed" });
      return finish({ decision: "allow", notice: "Router failed, but explicit allowQuickAnswerBypass=true was provided. Do not claim hardflow research." });
    }
    return finish(hardBlock(marker, `Router preflight failed: ${marker.routerPreflightFailureReason ?? routerOutput?.reasons?.[0] ?? "unknown failure"}. Ask the user whether to retry route or continue with a quick/direct answer; do not silently use ordinary web search.`, "router_failed_fail_closed"));
  }
  if (!routerOutput || marker.routeStatus === "router_required") {
    const fallback = autoRouteFallback("router_trace/routerOutput is missing for this hardflow marker.");
    if (fallback.ok) {
      trace = readRouterTrace(cwd, marker.runId, marker.turnId);
      routerOutput = fallback.routerOutput ?? trace?.routerOutput;
    } else {
      return finish(hardBlock(marker, `${fallback.reason ?? "router_trace/routerOutput is missing."} Stop gate fails closed; maxBlocks cannot allow a missing router_trace.`, "router_trace_missing_fail_closed"));
    }
  }
  if (trace && (trace.owner ?? "parent") === "subagent" && (marker.requiresSourceMatrix || marker.requiresExecutorManifest || marker.requiresValidation)) {
    return finish(blockOrAllow(marker, "Parent router_trace is missing for this hardflow marker; a subagent router_trace cannot satisfy the parent Stop gate."));
  }
  if (!routerOutput) {
    return finish(hardBlock(marker, "router_trace/routerOutput is missing after Stop auto-route fallback. Stop gate fails closed; maxBlocks cannot allow a missing router_trace.", "router_trace_missing_fail_closed"));
  }
  if (routerOutput.route === "router_failed") {
    marker = updateMarker(marker, { routeStatus: "router_failed" });
    if (config.allowQuickAnswerBypass && input.allowQuickAnswerBypass === true) {
      marker = updateMarker(marker, { status: "completed" });
      return finish({ decision: "allow", notice: "Router failed, but explicit allowQuickAnswerBypass=true was provided. Do not claim hardflow research." });
    }
    return finish(hardBlock(marker, `Router preflight failed: ${marker.routerPreflightFailureReason ?? routerOutput.reasons?.[0] ?? "unknown failure"}. Ask the user whether to retry route or continue with a quick/direct answer; do not silently use ordinary web search.`, "router_failed_fail_closed"));
  }
  if (routerOutput?.route === "bypass" || routerOutput?.bypass.requested) {
    updateMarker(marker, { status: "completed", routeStatus: "routed" });
    return finish({ decision: "allow", notice: "Router selected bypass; Stop gate allowed." });
  }
  if (routerOutput) marker = updateMarker(marker, { routeStatus: "routed", routerRoute: routerOutput.route });

  if (routerOutput?.route === "direct_answer") {
    updateMarker(marker, { status: "completed", routeStatus: "routed" });
    return finish({ decision: "allow", notice: "Router selected direct_answer; no research run is required." });
  }

  const automaticRouterResearch = routerOutput?.route === "research" && marker.triggerSource === "hook_user_prompt_submit";
  if (automaticRouterResearch) {
    const current = currentReportForMarker(cwd, marker);
    if (!current.report) {
      const autoRun = autoRunStrictResearch();
      if (!autoRun.ok) {
        return finish(
          hardBlock(
            marker,
            `${current.reason ?? "strict research_report.json is missing."} Stop auto-run strict research failed: ${autoRun.reason ?? "unknown failure"}. Do not answer from ordinary web_search/manual notes.`,
            "strict_research_report_missing"
          )
        );
      }
      return finish(
        hardBlock(
          marker,
          "strict_programmatic research completed in Stop hook. Answer only from the generated run-owned research_report.json, coverage_plan.json, evidence_ledger.json, and sdk_worker_runs; do not use ordinary web_search/manual notes as a substitute.",
          "strict_research_auto_run_completed"
        )
      );
    }
    if (current.report.runner_mode !== "strict_programmatic" && current.report.runner_mode !== "sdk_threads") {
      return finish(hardBlock(marker, `route=research requires strict_programmatic/sdk_threads research; runner_mode=${current.report.runner_mode} cannot satisfy it.`, "strict_research_wrong_runner"));
    }
    if (current.report.status === "failed") {
      return finish(hardBlock(marker, `strict_programmatic research failed: ${current.report.failure_reason ?? "missing failure_reason"}. Ask the user before downgrading to App/manual search.`, "strict_research_failed"));
    }
    const report = validateCurrentResearchReport(cwd, marker);
    if (!report.valid) return finish(hardBlock(marker, report.reason ?? "strict_programmatic research_report.json does not satisfy the current hardflow marker.", "strict_research_invalid"));
    const artifacts = validateAutomaticStrictResearchArtifacts(cwd, current.report);
    if (!artifacts.valid) return finish(hardBlock(marker, artifacts.reason ?? "strict_programmatic research artifacts are incomplete.", "strict_research_artifacts_incomplete"));
  }

  const requiresSourceMatrix = routerOutput?.requiresSourceMatrix ?? marker.requiresSourceMatrix;
  const requiresExecutorManifest = routerOutput?.requiresExecutorManifest ?? marker.requiresExecutorManifest;
  const requiresValidation = routerOutput?.requiresValidation ?? marker.requiresValidation;
  const requiresFinalHoldout = routerOutput?.requiresFinalHoldout ?? false;

  if (requiresSourceMatrix && !automaticRouterResearch) {
    const report = validateCurrentResearchReport(cwd, marker);
    if (!report.valid) return finish(blockOrAllow(marker, report.reason ?? "research_report.json does not satisfy the current hardflow marker."));
  }

  if (requiresExecutorManifest && !existsSync(executorManifestPath(cwd))) {
    return finish(blockOrAllow(marker, "executor_manifest.json is missing for this implementation marker. Generate .agent/manifests/executor_manifest.json before stopping."));
  }
  if (requiresExecutorManifest && existsSync(executorManifestPath(cwd))) {
    const manifest = parseJson<ExecutorManifestResearchFields>(executorManifestPath(cwd));
    const unresolved = manifest?.unresolvedResearchRequests ?? [];
    if (manifest?.externalResearchNeeded === true && unresolved.length > 0) {
      return finish(blockOrAllow(marker, `executor_manifest.externalResearchNeeded=true with unresolved blocking ResearchRequests: ${unresolved.join(", ")}.`));
    }
    if (manifest?.externalResearchNeeded === true && unresolved.length === 0) {
      const resolvedResearch = listResearchRequests(cwd, marker.runId).filter((request) => request.status === "resolved" && Boolean(request.linkedResearchRunId));
      if (resolvedResearch.length === 0) {
        return finish(blockOrAllow(marker, "executor_manifest.externalResearchNeeded=true but no resolved linked strict ResearchRequest was recorded."));
      }
    }
  }

  const requests = listResearchRequests(cwd, marker.runId);
  const blocking = blockingResearchRequests(requests);
  if (blocking.length > 0) {
    return finish(blockOrAllow(marker, `blocking ResearchRequest pending/running: ${blocking.map((request) => request.requestId).join(", ")}.`));
  }
  const failedBlocking = failedBlockingResearchRequests(requests);
  if (failedBlocking.length > 0) {
    return finish(blockOrAllow(marker, `blocking ResearchRequest failed: ${failedBlocking.map((request) => `${request.requestId}:${request.failureReason ?? "no failureReason"}`).join(", ")}. Ask the user whether to continue without external evidence.`));
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
