import { absoluteCommandFor } from "../cliPaths.js";
import { appendHookEvent, hashAdditionalContext } from "../hookEvents.js";
import { createHookMarker } from "../hookState.js";
import { researchRunRouterTracePath } from "../paths.js";
import { DEFAULT_AVAILABLE_AGENTS } from "../router/routerPrompt.js";

function allowOutput(additionalContext = ""): Record<string, unknown> {
  return {
    decision: "allow",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext
    }
  };
}

export function userPromptSubmit(input: Record<string, unknown> = {}, sourceRoot = process.cwd()): Record<string, unknown> {
  const prompt = String(input.prompt ?? input.user_prompt ?? input.message ?? "");
  if (!prompt.trim()) return allowOutput();

  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const marker = createHookMarker({
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
  const routeCommand = `${absoluteCommand} route --run-id ${JSON.stringify(marker.runId)} --write-trace --raw-user-prompt ${JSON.stringify(prompt)} ${JSON.stringify(prompt)}`;
  const strictResearchCommand = `${absoluteCommand} research --strict-programmatic --coverage-mode exhaustive --parallel-policy all_required --run-id ${JSON.stringify(marker.runId)} --raw-user-prompt ${JSON.stringify(prompt)} ${JSON.stringify(prompt)}`;

  const additionalContext = [
      `codex-hardflow router preflight is required for every non-empty user prompt in this turn. Hook command fallback: ${absoluteCommand}. Prefer this absolute command even if shell PATH can find codex-hardflow; app PATH may differ.`,
      `Hardflow marker: turnId=${marker.turnId}, runId=${marker.runId}, promptHash=${marker.promptHash}, createdAt=${marker.createdAt}, expiresAt=${marker.expiresAt}, routeStatus=router_required. Stop gate must use marker.runId plus router_trace/routerOutput, not keyword reclassification.`,
      `First create or verify router_trace at ${routerTracePath}. If the hook environment cannot safely call the structured LLM router directly, run exactly: ${routeCommand}.`,
      "Router must infer user intent semantically, not by keyword matching. If structured output is unavailable, keep routeStatus=router_required until codex-hardflow route writes router_trace; do not use keyword fallback.",
      "If routerOutput.route=direct_answer, do not create a research run, do not require Source Coverage Matrix, and do not claim hardflow executed beyond router preflight.",
      `If routerOutput.route=research, immediately run strict programmatic exhaustive research with all required buckets in parallel: ${strictResearchCommand}.`,
      "Research route rules: use strict_programmatic/sdk_threads only; no App subagents, no manual fallback, no AGENTS.md/skill fallback, no silent downgrade. If strict_programmatic fails, write status=failed and failure_reason.",
      "Ordinary web_search output, ad hoc notes, or manual browsing cannot satisfy route=research. A research route must produce run-owned research_report.json, coverage_plan.json, evidence_ledger.json, and sdk_worker_runs before the final answer.",
      "Implementation route rules: start from local_repo. If planning/execution discovers external docs, examples, security/version behavior, GitHub issues, similar implementations, or troubleshooting evidence is needed, create a ResearchRequest and resolve it through strict_programmatic research instead of guessing.",
      `Available agents for routing context only: ${agentNames}. App subagents remain best-effort and are not the strict execution layer.`,
      `ResearchRequest CLI examples for this runId: codex-hardflow research request create --run-id ${marker.runId} --requested-by executor --stage execution --reason \"external docs needed\" --question \"...\" --required-buckets official_docs,github; codex-hardflow research request run --strict-programmatic --run-id ${marker.runId} --request-id <requestId>.`,
      "For app_handoff/manual modes, require explicit user approval to downgrade after strict failure. Backfilled App/manual evidence must be recorded with official report commands and must not claim programmaticMultiAgent unless SDK/deterministic workers ran.",
      "Do not use inline internal TypeScript imports or development TypeScript entrypoints for normal runs; those are for explicit maintainer work only.",
      "If routerOutput.requiresExecutorManifest, write .agent/manifests/executor_manifest.json before stopping. If executor_manifest.externalResearchNeeded=true, unresolved blocking ResearchRequests must be resolved or explicitly failed before completion. If routerOutput requiresValidation or requiresFinalHoldout, keep validator feedback sanitized and run the required validation/final-holdout gate before claiming completion."
    ].join(" ");

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
