import { absoluteCommandFor } from "../cliPaths.js";
import { appendHookEvent, hashAdditionalContext } from "../hookEvents.js";
import { createHookMarker, type HookMarker } from "../hookState.js";
import { hardflowInternalContext } from "../internalEnv.js";
import { writeHookInputJson, type RoutePreflightRunner } from "./hookAutomation.js";
import { hardflowJobPath, researchRunRouterTracePath } from "../paths.js";
import { DEFAULT_AVAILABLE_AGENTS } from "../router/routerPrompt.js";
import { createHardflowJob } from "../jobs/jobStore.js";

export interface UserPromptSubmitOptions {
  routeRunner?: RoutePreflightRunner;
  config?: Record<string, unknown>;
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

function buildAdditionalContext(params: {
  marker: HookMarker;
  absoluteCommand: string;
  routerTracePath: string;
  hookInputPath: string;
  jobPath: string;
  agentNames: string;
}): string {
  const { marker, absoluteCommand, routerTracePath, hookInputPath, jobPath, agentNames } = params;
  return [
    `codex-hardflow UserPromptSubmit queued a HardFlow job. Hook command fallback: ${absoluteCommand}. Prefer this absolute command even if shell PATH can find codex-hardflow; app PATH may differ.`,
    `Hardflow marker: turnId=${marker.turnId}, runId=${marker.runId}, promptHash=${marker.promptHash}, createdAt=${marker.createdAt}, expiresAt=${marker.expiresAt}, routeStatus=${marker.routeStatus ?? "unknown"}.`,
    `HardFlow job path: ${jobPath}. Job status starts as pending; daemon/jobs runner is responsible for route and strict research.`,
    `Hook input path: ${hookInputPath}. Future route/research commands must pass --input-json instead of embedding the raw prompt in argv.`,
    `Expected router trace path after daemon routing: ${routerTracePath}.`,
    "Do not answer route=research until the HardFlow job completed and run-owned artifacts exist. Stop hook will block while the job is pending, routing, or researching.",
    "UserPromptSubmit does not run Codex SDK, Codex CLI route, or long strict research synchronously.",
    `Run pending jobs with: ${absoluteCommand} jobs run-pending. Run this job once with: ${absoluteCommand} jobs run-once --run-id ${marker.runId}. Daemon command: ${absoluteCommand} daemon run.`,
    `Available agents for routing context only: ${agentNames}. App subagents remain best-effort and are not the strict execution layer.`,
    "Ordinary web_search output, ad hoc notes, manual browsing, AGENTS.md, or skill guidance cannot satisfy a completed strict research job."
  ].join(" ");
}

export function userPromptSubmit(input: Record<string, unknown> = {}, sourceRoot = process.cwd(), options: UserPromptSubmitOptions = {}): Record<string, unknown> {
  void options;
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
  const hookInputPath = writeHookInputJson(cwd, marker.runId, {
    runId: marker.runId,
    rawUserPrompt: prompt,
    turnId: marker.turnId,
    cwd,
    sourceRoot,
    triggerSource: "hook_user_prompt_submit"
  });
  const job = createHardflowJob({
    runId: marker.runId,
    cwd,
    rawUserPrompt: prompt,
    promptHash: marker.promptHash,
    turnId: marker.turnId,
    triggerSource: "hook_user_prompt_submit"
  });

  const additionalContext = buildAdditionalContext({
    marker,
    absoluteCommand,
    routerTracePath,
    hookInputPath,
    jobPath: hardflowJobPath(cwd, job.runId),
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
