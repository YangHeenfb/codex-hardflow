import { classifyTask, shouldUseHardflow } from "../classify.js";
import { absoluteCommandFor } from "../cliPaths.js";
import { createHookMarker, type HookTaskType } from "../hookState.js";

function allowOutput(additionalContext = ""): Record<string, unknown> {
  return {
    decision: "allow",
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext
    }
  };
}

function hasBypass(prompt: string): boolean {
  return /\b(do not use hardflow|no hardflow|skip hardflow|bypass hardflow|quick answer)\b|不要\s*(使用\s*)?hardflow|禁用\s*hardflow|直接回答|不做多源研究/i.test(prompt);
}

function isMaintenanceTask(prompt: string): boolean {
  return /codex-hardflow|hardflow|stop hook|userpromptsubmit|install-global|hook repair|skill discovery|check-only|research-only|docs?|tests?|config|path/i.test(prompt) &&
    /\b(fix|repair|install|status|check|test|docs?|config|maintenance|hook|path)\b|修复|安装|维护/.test(prompt);
}

function explicitImplementationValidationRequested(prompt: string): boolean {
  return /\b(run|require|must|execute)\s+(codex-hardflow\s+)?(validate|validation|final holdout|hidden validation)\b|\bmust\s+write\s+executor_manifest\b/i.test(prompt);
}

function taskTypeFor(prompt: string): { taskType: HookTaskType; requiresSourceMatrix: boolean; requiresExecutorManifest: boolean; requiresValidation: boolean; bypass: boolean } {
  const classification = classifyTask(prompt);
  const bypass = hasBypass(prompt);
  if (bypass) {
    return { taskType: "bypass", requiresSourceMatrix: false, requiresExecutorManifest: false, requiresValidation: false, bypass: true };
  }
  const maintenance = isMaintenanceTask(prompt);
  const explicitMaintenanceValidation = maintenance && explicitImplementationValidationRequested(prompt);
  if (maintenance && !explicitMaintenanceValidation) {
    return { taskType: "hardflow-maintenance", requiresSourceMatrix: false, requiresExecutorManifest: false, requiresValidation: false, bypass: false };
  }
  const requiresSourceMatrix = classification.researchHeavy;
  const requiresExecutorManifest = classification.implementation;
  const requiresValidation = classification.validationSensitive && classification.implementation;
  const taskType = requiresValidation ? "validation-sensitive" : requiresExecutorManifest ? "implementation" : "research-heavy";
  return { taskType, requiresSourceMatrix, requiresExecutorManifest, requiresValidation, bypass: false };
}

export function userPromptSubmit(input: Record<string, unknown> = {}, sourceRoot = process.cwd()): Record<string, unknown> {
  const prompt = String(input.prompt ?? input.user_prompt ?? input.message ?? "");
  const classification = classifyTask(prompt);
  const bypass = hasBypass(prompt);
  if (!shouldUseHardflow(prompt) && !bypass) return allowOutput();

  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const routing = taskTypeFor(prompt);
  const marker = createHookMarker({
    cwd,
    prompt,
    sourceRoot,
    taskType: routing.taskType,
    requiresSourceMatrix: routing.requiresSourceMatrix,
    requiresExecutorManifest: routing.requiresExecutorManifest,
    requiresValidation: routing.requiresValidation,
    bypass: routing.bypass,
    input
  });

  if (routing.bypass) {
    return allowOutput(`codex-hardflow bypass marker recorded for this turn (${marker.turnId}); Stop gate will allow.`);
  }

  const absoluteCommand = absoluteCommandFor(sourceRoot);
  const researcherAgents = [
    "official_docs_researcher",
    "github_researcher",
    "community_researcher",
    "academic_researcher",
    "package_security_researcher",
    "codex_default_researcher",
    ...(classification.localRepoRelevant ? ["local_repo_researcher"] : []),
    ...(classification.competitorRelevant ? ["competitor_researcher"] : [])
  ];
  const maintenanceNote =
    routing.taskType === "hardflow-maintenance"
      ? "This is hardflow maintenance; do not require a business executor_manifest.json unless explicit implementation validation is requested. If a manifest is useful, write a maintenance manifest instead."
      : "";
  return allowOutput(
    [
      `Use codex-hardflow for this turn. Hook command fallback: ${absoluteCommand}. Prefer this absolute command even if shell PATH can find codex-hardflow; app PATH may differ.`,
      `Hardflow marker: turnId=${marker.turnId}, runId=${marker.runId}, promptHash=${marker.promptHash}, createdAt=${marker.createdAt}, expiresAt=${marker.expiresAt}. Stop gate must only use the marker/runId for this turn/thread.`,
      routing.requiresSourceMatrix
        ? [
            "This is a research-heavy task. Use app_handoff mode for interactive Codex App research.",
            "Do not synchronously launch Codex SDK researcher threads unless explicitly requested with --runner sdk_threads or --execute-sdk-research.",
            `Generate or verify the parent report at .agent/reports/runs/${marker.runId}/research_report.json and the current copy at .agent/reports/current/research_report.json in app_handoff mode. Always include codex_default_researcher.`,
            "Before manual web search, discover/load available multi-agent or subagent capability; if a lazy-loaded tool is required, load it first.",
            `If subagent capability is available, explicitly spawn these source-specific researcher subagents: ${researcherAgents.join(", ")}.`,
            `Safe App handoff command example: ${absoluteCommand} research --runner app_handoff --run-id ${JSON.stringify(marker.runId)} --raw-user-prompt ${JSON.stringify(prompt)} ${JSON.stringify(prompt)}.`,
            "If subagents are unavailable, set subagent_status = unavailable with reason.",
            `Subagents must not write the parent report or current report. They may write only .agent/reports/runs/${marker.runId}/subagents/<agent>-<bucket>.json, or output JSON for the parent to merge.`,
            `Backfill App/manual/subagent results using official CLI commands with this runId: codex-hardflow report add-source --run-id ${marker.runId}, codex-hardflow report add-subagent-report --run-id ${marker.runId}, codex-hardflow report merge-subagents --run-id ${marker.runId}, and codex-hardflow report finalize-manual --run-id ${marker.runId}.`,
            "Do not use inline internal TypeScript imports or development TypeScript entrypoints to backfill research_report in normal App research tasks; those dev entrypoints are for explicit maintainer work only.",
            "Do not produce a final answer until the run-owned parent research_report.json exists for this promptHash and contains source_matrix, codex_default_discovery_status, agent_runs, bucket_statuses, owner=parent, runId, and recorded evidence."
          ].join(" ")
        : "",
      routing.requiresExecutorManifest ? "For non-maintenance implementation, write .agent/manifests/executor_manifest.json before stopping." : "",
      routing.requiresValidation ? "For validation-sensitive implementation, keep validator feedback sanitized and run the repair/final-holdout loop before claiming completion." : "",
      maintenanceNote
    ]
      .filter(Boolean)
      .join(" ")
  );
}
