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

function shouldInjectExplicitSubagentSpawn(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const simpleDirect = /(^|\s)(translate|rewrite|grammar|hello|hi)\b/.test(text) || /翻译|润色|改写|闲聊/.test(prompt);
  const localOnlyPlan = /不要改代码|先不要改代码|只给.*计划|implementation plan only|plan only/.test(prompt) && !/类似|竞品|替代|对比|调研|current|latest|similar|competitor|alternative|research/.test(text);
  if (simpleDirect || localOnlyPlan) return false;
  return /research|current|latest|compare|similar|competitor|alternative|architecture|framework|troubleshoot|security|evaluation|multi[-\s]?agent|products?|projects?/.test(text)
    || /调研|当前|最新|对比|比较|类似|竞品|替代|方案|架构|框架|排查|安全|评测|产品|项目|吸收|改进/.test(prompt);
}

function explicitSubagentSpawnInstruction(markerRunId: string): string {
  return [
    "This task requires explicit source-specific subagent spawning if the App subagent capability is available.",
    "Spawn the relevant source-specific researcher subagents:",
    "local_repo_researcher when local repo/current project is relevant;",
    "competitor_researcher when similar products/projects/alternatives are relevant;",
    "official_docs_researcher;",
    "github_researcher;",
    "community_researcher;",
    "academic_researcher;",
    "package_security_researcher;",
    "codex_default_researcher.",
    "If Codex decides not to spawn subagents, it must record subagent_status = \"not_spawned\" and subagent_skip_reason = \"...\" in research_report.",
    "Manual/App search may be used only if sources are backfilled into the report.",
    "Do not say subagents are unavailable merely because the user did not explicitly ask; this hardflow injected context is the explicit request.",
    `Subagents must not write the parent report or current report. They may write only .agent/reports/runs/${markerRunId}/subagents/<agent>-<bucket>.json or .agent/reports/runs/${markerRunId}/subagents/<agent>-<bucket>.router_trace.json, or output JSON for the parent to merge.`
  ].join(" ");
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
    input
  });

  const absoluteCommand = absoluteCommandFor(sourceRoot);
  const agentNames = DEFAULT_AVAILABLE_AGENTS.map((agent) => agent.name).join(", ");
  const routerTracePath = researchRunRouterTracePath(cwd, marker.runId);
  const spawnInstruction = shouldInjectExplicitSubagentSpawn(prompt) ? explicitSubagentSpawnInstruction(marker.runId) : "";

  const additionalContext = [
      `codex-hardflow router preflight is required for this turn. Hook command fallback: ${absoluteCommand}. Prefer this absolute command even if shell PATH can find codex-hardflow; app PATH may differ.`,
      `Hardflow marker: turnId=${marker.turnId}, runId=${marker.runId}, promptHash=${marker.promptHash}, createdAt=${marker.createdAt}, expiresAt=${marker.expiresAt}. Stop gate must use marker.runId plus router_trace/routerOutput, not keyword reclassification.`,
      `First create or verify router_trace at ${routerTracePath}. In Codex App hook mode, do not synchronously launch Codex SDK router threads from the hook; perform the LLM Router preflight in this turn and write schema JSON.`,
      "Router must infer user intent semantically, not by keyword matching. If router fails, set route=router_failed and do not silently use keyword fallback.",
      "Router failed behavior: do not claim hardflow classification; if the task seems to require code changes, ask for confirmation before modifying files; if the user wants hardflow, ask them to rerun or explicitly request hardflow after fixing router.",
      `Available agents for routing: ${agentNames}. Use agent descriptions and required source buckets to decide requiredAgents.`,
      "If routerOutput requiresSourceMatrix, App interactive research should use app_handoff by default. Do not synchronously launch SDK researcher threads unless explicitly requested with --runner sdk_threads or --execute-sdk-research.",
      `Safe App handoff command example after router route=research: ${absoluteCommand} research --runner app_handoff --run-id ${JSON.stringify(marker.runId)} --raw-user-prompt ${JSON.stringify(prompt)} ${JSON.stringify(prompt)}.`,
      spawnInstruction,
      `Backfill App/manual/subagent results using official CLI commands with this runId: codex-hardflow report add-source --run-id ${marker.runId}, codex-hardflow report add-subagent-report --run-id ${marker.runId}, codex-hardflow report merge-subagents --run-id ${marker.runId}, and codex-hardflow report finalize-manual --run-id ${marker.runId}.`,
      "For normal App runs, use the formal codex-hardflow CLI or absolute command. Do not use inline internal TypeScript imports or development TypeScript entrypoints to backfill research_report; those are for explicit maintainer work only.",
      "If routerOutput requiresExecutorManifest, write .agent/manifests/executor_manifest.json before stopping. If routerOutput requiresValidation or requiresFinalHoldout, keep validator feedback sanitized and run the required validation/final-holdout gate before claiming completion."
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
