import { absoluteCommandFor } from "../cliPaths.js";
import { DEFAULT_TRIGGER_RUNTIME_CONFIG, type TriggerRuntimeConfig } from "../config.js";
import { appendHookEvent, hashAdditionalContext } from "../hookEvents.js";
import { createHookMarker, updateMarker, type HookMarker } from "../hookState.js";
import { hardflowInternalContext } from "../internalEnv.js";
import { defaultRoutePreflightRunner, formatCommand, routeCommandArgs, strictResearchCommandArgs, writeHookInputJson, type RoutePreflightResult, type RoutePreflightRunner } from "./hookAutomation.js";
import { researchRunRouterTracePath } from "../paths.js";
import { DEFAULT_AVAILABLE_AGENTS } from "../router/routerPrompt.js";
import type { RouterTrace } from "../router/routerSchema.js";

export interface UserPromptSubmitOptions {
  routeRunner?: RoutePreflightRunner;
  config?: Partial<TriggerRuntimeConfig>;
}

function allowOutput(additionalContext = ""): Record<string, unknown> {
  return {
    decision: "allow",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext
    }
  };
}

function configWithDefaults(config: Partial<TriggerRuntimeConfig> | undefined): TriggerRuntimeConfig {
  return { ...DEFAULT_TRIGGER_RUNTIME_CONFIG, ...(config ?? {}) };
}

function markerPatchFromRouteResult(result: RoutePreflightResult): Partial<HookMarker> {
  const route = result.trace?.route;
  return {
    routeStatus: result.succeeded ? "routed" : "router_failed",
    routerTracePath: result.tracePath,
    routerRoute: route,
    routerPreflightSource: "user_prompt_submit",
    routerPreflightSucceeded: result.succeeded,
    routerPreflightFailureReason: result.succeeded ? undefined : result.failureReason,
    routerPreflightCompletedAt: new Date().toISOString()
  };
}

function routeDescription(trace: RouterTrace | undefined): string {
  if (!trace) return "route=unavailable";
  return `route=${trace.route}, requiresSourceMatrix=${trace.requiresSourceMatrix}, coverageMode=${trace.coverageMode ?? "null"}, parallelPolicy=${trace.parallelPolicy ?? "null"}`;
}

function buildAdditionalContext(params: {
  marker: HookMarker;
  prompt: string;
  absoluteCommand: string;
  routerTracePath: string;
  routeCommand: string;
  strictResearchCommand: string;
  hookInputPath: string;
  routeResult?: RoutePreflightResult;
  agentNames: string;
}): string {
  const { marker, prompt, absoluteCommand, routerTracePath, routeCommand, strictResearchCommand, hookInputPath, routeResult, agentNames } = params;
  const trace = routeResult?.trace;
  const base = [
    `codex-hardflow UserPromptSubmit created marker and ran router preflight programmatically. Hook command fallback: ${absoluteCommand}. Prefer this absolute command even if shell PATH can find codex-hardflow; app PATH may differ.`,
    `Hardflow marker: turnId=${marker.turnId}, runId=${marker.runId}, promptHash=${marker.promptHash}, createdAt=${marker.createdAt}, expiresAt=${marker.expiresAt}, routeStatus=${marker.routeStatus ?? "unknown"}. Stop gate must use marker.runId plus router_trace/routerOutput, not keyword reclassification.`,
    `Hook input path: ${hookInputPath}. Commands must pass --input-json instead of embedding the raw prompt in argv.`,
    `Router trace path: ${routerTracePath}. Router preflight result: ${routeDescription(trace)}.`,
    "Router inferred user intent semantically, not by keyword matching; do not use keyword fallback.",
    `Route retry command if explicitly needed: ${routeCommand}.`,
    `Available agents for routing context only: ${agentNames}. App subagents remain best-effort and are not the strict execution layer.`,
    `ResearchRequest CLI examples for this runId: codex-hardflow research request create --run-id ${marker.runId} --requested-by executor --stage execution --reason "external docs needed" --question "..." --required-buckets official_docs,github; codex-hardflow research request run --strict-programmatic --run-id ${marker.runId} --request-id <requestId>.`,
    "Do not use inline internal TypeScript imports or development TypeScript entrypoints for normal runs; those are for explicit maintainer work only."
  ];

  if (!routeResult?.succeeded) {
    return [
      ...base,
      `Router preflight failed: ${routeResult?.failureReason ?? "unknown failure"}. Stop hook must fail closed or retry route; do not silently allow hardflow claims.`,
      "Do not answer a research-heavy prompt with ordinary web_search/manual notes while router preflight is failed."
    ].join(" ");
  }

  if (trace?.route === "direct_answer") {
    return [
      ...base,
      "Router selected route=direct_answer. No hardflow research run, Source Coverage Matrix, EvidenceLedger, or strict_programmatic execution is required for this prompt.",
      "Do not claim hardflow research executed; only router preflight ran."
    ].join(" ");
  }

  if (trace?.route === "research") {
    return [
      ...base,
      `Router selected route=research. Run strict programmatic exhaustive research with all required buckets in parallel: ${strictResearchCommand}.`,
      "Research route rules: use strict_programmatic/sdk_threads only; no App subagents, no manual fallback, no AGENTS.md/skill fallback, no silent downgrade. If strict_programmatic fails, write status=failed and failure_reason.",
      "Ordinary web_search output, ad hoc notes, or manual browsing cannot satisfy route=research. A research route must produce run-owned research_report.json, coverage_plan.json, evidence_ledger.json, and sdk_worker_runs before the final answer."
    ].join(" ");
  }

  if (trace?.route === "implementation" || trace?.route === "validation_sensitive_implementation" || trace?.route === "parallel_modules") {
    return [
      ...base,
      `Router selected route=${trace.route}. Start from local_repo context and produce executor_manifest.json when implementation work is performed.`,
      "If planning/execution discovers external docs, examples, security/version behavior, GitHub issues, similar implementations, or troubleshooting evidence is needed, create a ResearchRequest and resolve it through strict_programmatic research instead of guessing.",
      "If routerOutput.requiresExecutorManifest, write .agent/manifests/executor_manifest.json before stopping. If executor_manifest.externalResearchNeeded=true, unresolved blocking ResearchRequests must be resolved or explicitly failed before completion. If routerOutput requiresValidation or requiresFinalHoldout, keep validator feedback sanitized and run the required validation/final-holdout gate before claiming completion."
    ].join(" ");
  }

  return [
    ...base,
    `Router selected route=${trace?.route ?? "unknown"}. Follow router_trace/routerOutput and Stop gate requirements. Do not claim strict hardflow completion without run-owned artifacts.`
  ].join(" ");
}

export function userPromptSubmit(input: Record<string, unknown> = {}, sourceRoot = process.cwd(), options: UserPromptSubmitOptions = {}): Record<string, unknown> {
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const internal = hardflowInternalContext();
  if (internal.internal) {
    appendHookEvent(cwd, {
      eventName: "UserPromptSubmitInternalBypass",
      runId: internal.parentRunId,
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: false,
      internalPurpose: internal.purpose,
      parentRunId: internal.parentRunId,
      recursionDepth: internal.depth,
      recursionLimitHit: internal.recursionLimitHit,
      decision: "allow",
      reason: "CODEX_HARDFLOW_INTERNAL bypass"
    });
    return {
      decision: "allow",
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmitInternalBypass",
        additionalContext: ""
      }
    };
  }
  const prompt = String(input.prompt ?? input.user_prompt ?? input.message ?? "");
  if (!prompt.trim()) return allowOutput();
  const config = configWithDefaults(options.config);

  let marker = createHookMarker({
    cwd,
    prompt,
    sourceRoot,
    taskType: "router-preflight",
    requiresSourceMatrix: false,
    requiresExecutorManifest: false,
    requiresValidation: false,
    triggerSource: "hook_user_prompt_submit",
    programmaticTrigger: true,
    routeStatus: "router_required",
    input
  });

  const absoluteCommand = absoluteCommandFor(sourceRoot);
  const agentNames = DEFAULT_AVAILABLE_AGENTS.map((agent) => agent.name).join(", ");
  const routerTracePath = researchRunRouterTracePath(cwd, marker.runId);
  const hookInputPath = writeHookInputJson(cwd, marker.runId, {
    runId: marker.runId,
    rawUserPrompt: prompt,
    turnId: marker.turnId,
    cwd,
    sourceRoot,
    triggerSource: "hook_user_prompt_submit"
  });
  const routeCommand = formatCommand(absoluteCommand, routeCommandArgs(marker.runId, prompt, config.routePreflightTimeoutMs, hookInputPath));
  const strictResearchCommand = formatCommand(absoluteCommand, strictResearchCommandArgs(marker.runId, prompt, hookInputPath));
  let routeResult: RoutePreflightResult | undefined;

  if (config.autoRouteOnUserPromptSubmit) {
    const routeRunner = options.routeRunner ?? defaultRoutePreflightRunner;
    routeResult = routeRunner({
      cwd,
      command: absoluteCommand,
      runId: marker.runId,
      rawUserPrompt: prompt,
      timeoutMs: config.routePreflightTimeoutMs,
      turnId: marker.turnId,
      inputJsonPath: hookInputPath,
      triggerSource: "hook_user_prompt_submit"
    });
    marker = updateMarker(marker, markerPatchFromRouteResult(routeResult));
  }

  const additionalContext = buildAdditionalContext({
    marker,
    prompt,
    absoluteCommand,
    routerTracePath,
    routeCommand,
    strictResearchCommand,
    hookInputPath,
    routeResult,
    agentNames
  });

  appendHookEvent(cwd, {
    eventName: "UserPromptSubmit",
    runId: marker.runId,
    turnId: marker.turnId,
    promptHash: marker.promptHash,
    triggerSource: marker.triggerSource,
    programmaticTrigger: marker.programmaticTrigger,
    injectedAdditionalContextHash: hashAdditionalContext(additionalContext)
  });

  return allowOutput(additionalContext);
}
