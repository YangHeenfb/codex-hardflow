import { absoluteCommandFor } from "../cliPaths.js";
import { appendHookEvent, hashAdditionalContext } from "../hookEvents.js";
import { createHookMarker, type HookMarker } from "../hookState.js";
import { hardflowInternalContext } from "../internalEnv.js";
import { writeHookInputJson, type RoutePreflightRunner } from "./hookAutomation.js";
import { hardflowJobPath, researchRunEvidenceLedgerPath, researchRunReportPath, researchRunRouterTracePath } from "../paths.js";
import { DEFAULT_AVAILABLE_AGENTS } from "../router/routerPrompt.js";
import { completeHardflowJob, createHardflowJob, listHardflowJobs, readHardflowJob, refreshHardflowQueueState } from "../jobs/jobStore.js";
import { DEFAULT_DAEMON_RUNTIME_CONFIG } from "../config.js";
import type { HardflowJob } from "../jobs/jobSchema.js";

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

function blockOutput(reason: string, additionalContext = ""): Record<string, unknown> {
  return {
    decision: "block",
    reason,
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

function isResultRequest(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return (
    /查看\s*hardflow\s*结果/i.test(prompt) ||
    /hardflow\s+status/i.test(normalized) ||
    /hardflow\s+result/i.test(normalized) ||
    /查看\s*runid/i.test(normalized) ||
    /^继续$/.test(prompt.trim()) ||
    /^结果呢[？?]?$/.test(prompt.trim())
  );
}

function extractRequestedRunId(prompt: string): string | undefined {
  const explicit = prompt.match(/runId\s*[:=]?\s*([A-Za-z0-9_.:-]+)/i) ?? prompt.match(/run[-_][A-Za-z0-9_.:-]+/);
  return explicit ? (explicit[1] ?? explicit[0]) : undefined;
}

function latestJob(cwd: string): HardflowJob | null {
  const jobs = listHardflowJobs(cwd);
  return jobs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}

function isDirectAdmissionPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const researchSignals = /(current|latest|前沿|现在|practical|solutions|方案|类似|项目|产品|compare|comparison|research|docs|github|security|hidden validation|long horizon)/i;
  if (researchSignals.test(trimmed)) return false;
  if (/^(hi|hello|hey|thanks|thank you)[.!?。！]*$/i.test(trimmed)) return true;
  if (/^(translate|翻译)\b/i.test(trimmed)) return true;
  if (/翻译成|翻译为|translate .* to /i.test(trimmed)) return true;
  if (/^(rewrite|改写|润色)\b/i.test(trimmed)) return true;
  if (/^quick answer[:：]/i.test(trimmed)) return true;
  if (lower.length <= 80 && /^(what is|什么是|解释一下)\b/i.test(trimmed)) return true;
  return false;
}

function statusReasonForJob(job: HardflowJob, action: "queued" | "pending" | "failed"): string {
  const statusCommand = `codex-hardflow jobs status --run-id ${job.runId}`;
  const queue = job.queuePosition !== null && job.queuePosition !== undefined ? ` queuePosition=${job.queuePosition}` : "";
  if (action === "failed") {
    return `HardFlow job failed. runId=${job.runId} status=${job.status}${queue} failureReason=${job.failureReason ?? "unknown"}. Ordinary answer is not allowed unless user explicitly approves downgrade. Check status with ${statusCommand}.`;
  }
  const lead = action === "queued" ? "HardFlow strict research queued." : "HardFlow job is not complete.";
  return `${lead} runId=${job.runId} status=${job.status}${queue}. This research-heavy prompt will not be answered from ordinary web_search/manual notes. Check status with ${statusCommand}. To retrieve later, ask: 查看 HardFlow 结果 ${job.runId}.`;
}

function handleResultRequest(cwd: string, prompt: string): Record<string, unknown> | null {
  if (!isResultRequest(prompt)) return null;
  const runId = extractRequestedRunId(prompt);
  const job = runId ? readHardflowJob(cwd, runId) : latestJob(cwd);
  if (!job) {
    return allowOutput("No HardFlow job was found for this workspace. Do not claim HardFlow research completed.");
  }
  refreshHardflowQueueState(cwd, DEFAULT_DAEMON_RUNTIME_CONFIG);
  const refreshed = readHardflowJob(cwd, job.runId) ?? job;
  if (refreshed.status === "completed") {
    if (refreshed.route === "research") {
      return allowOutput(
        `HardFlow run ${refreshed.runId} is completed. Answer only from run-owned artifacts: research_report=${refreshed.researchReportPath ?? researchRunReportPath(cwd, refreshed.runId)}, evidence_ledger=${refreshed.evidenceLedgerPath ?? researchRunEvidenceLedgerPath(cwd, refreshed.runId)}. Do not use ordinary web_search/manual notes as a substitute.`
      );
    }
    return allowOutput(`HardFlow run ${refreshed.runId} completed with route=${refreshed.route}; no strict research result is required.`);
  }
  if (refreshed.status === "failed" || refreshed.status === "cancelled") {
    return blockOutput(statusReasonForJob(refreshed, "failed"), `HardFlow job failed or was cancelled. Ask the user before downgrading to App/manual search. runId=${refreshed.runId}.`);
  }
  return blockOutput(statusReasonForJob(refreshed, "pending"), `HardFlow job is still ${refreshed.status}. runId=${refreshed.runId}.`);
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
  const resultRequest = handleResultRequest(cwd, prompt);
  if (resultRequest) return resultRequest;
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

  if (isDirectAdmissionPrompt(prompt)) {
    const completed = completeHardflowJob(cwd, marker.runId, {
      route: "direct_answer",
      routerTracePath: null,
      threadIds: []
    });
    const additionalContext = `codex-hardflow admission selected direct_answer for runId=${completed.runId}; no HardFlow strict research is required. Do not claim research_report/EvidenceLedger was produced.`;
    appendHookEvent(cwd, {
      eventName: "UserPromptSubmit",
      runId: marker.runId,
      turnId: marker.turnId,
      promptHash: marker.promptHash,
      triggerSource: marker.triggerSource,
      programmaticTrigger: marker.programmaticTrigger,
      decision: "allow",
      injectedAdditionalContextHash: hashAdditionalContext(additionalContext)
    });
    return allowOutput(additionalContext);
  }

  refreshHardflowQueueState(cwd, DEFAULT_DAEMON_RUNTIME_CONFIG);
  const queued = readHardflowJob(cwd, marker.runId) ?? job;

  const additionalContext = buildAdditionalContext({
    marker,
    absoluteCommand,
    routerTracePath,
    hookInputPath,
    jobPath: hardflowJobPath(cwd, job.runId),
    agentNames
  });
  const reason = statusReasonForJob(queued, "queued");

  appendHookEvent(cwd, {
    eventName: "UserPromptSubmit",
    runId: marker.runId,
    turnId: marker.turnId,
    promptHash: marker.promptHash,
    triggerSource: marker.triggerSource,
    programmaticTrigger: marker.programmaticTrigger,
    decision: "block",
    reason,
    injectedAdditionalContextHash: hashAdditionalContext(additionalContext)
  });

  return blockOutput(reason, additionalContext);
}
