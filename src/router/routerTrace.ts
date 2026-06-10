import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentRouterTracePath, hardflowStateDir, repoHash, researchRunRouterTracePath, researchSubagentRouterTracePath } from "../paths.js";
import { hashText } from "../hookState.js";
import type { TriggerSource } from "../schemas.js";
import type { RouterInput, RouterMode, RouterOutput, RouterTrace, RouterTraceOwner } from "./routerSchema.js";

export interface RouterTraceOwnership {
  owner?: RouterTraceOwner;
  parentRunId?: string;
  subagentName?: string;
  bucket?: string;
  triggerSource?: TriggerSource;
  programmaticTrigger?: boolean;
}

export function buildRouterTrace(
  input: RouterInput,
  output: RouterOutput,
  routerMode: RouterMode,
  fallbackReason?: string,
  turnId?: string,
  ownership: RouterTraceOwnership = {}
): RouterTrace {
  const owner = ownership.owner ?? "parent";
  return {
    runId: input.currentRunId,
    turnId,
    owner,
    parentRunId: ownership.parentRunId,
    subagentName: ownership.subagentName,
    bucket: ownership.bucket,
    triggerSource: ownership.triggerSource ?? input.triggerSource ?? "unknown",
    programmaticTrigger: ownership.programmaticTrigger ?? input.programmaticTrigger ?? false,
    rawUserPrompt: input.rawUserPrompt,
    normalizedTask: input.normalizedTask,
    promptHash: hashText(input.rawUserPrompt),
    routerMode,
    route: output.route,
    workflowPattern: output.workflowPattern,
    researchProfile: output.researchProfile,
    validationProfile: output.validationProfile,
    sourceBuckets: output.sourceBuckets,
    requiredAgents: output.requiredAgents,
    requiresSourceMatrix: output.requiresSourceMatrix,
    requiresExecutorManifest: output.requiresExecutorManifest,
    requiresValidation: output.requiresValidation,
    requiresFinalHoldout: output.requiresFinalHoldout,
    requiresParallelIsolation: output.requiresParallelIsolation,
    reasons: output.reasons,
    risks: output.risks,
    fallbackReason,
    createdAt: new Date().toISOString(),
    routerOutput: output
  };
}

export function stateRouterTracePath(cwd: string, turnId: string): string {
  return join(hardflowStateDir(), repoHash(cwd), turnId, "router_trace.json");
}

export function writeRouterTrace(cwd: string, trace: RouterTrace, updateCurrent = true): RouterTrace {
  const owner = trace.owner ?? "parent";
  let targets: string[] = [];
  if (owner === "subagent") {
    if (!trace.parentRunId || !trace.subagentName || !trace.bucket) {
      throw new Error("Subagent router_trace requires parentRunId, subagentName, and bucket.");
    }
    targets = [researchSubagentRouterTracePath(cwd, trace.parentRunId, trace.subagentName, trace.bucket)];
  } else if (trace.runId) {
    targets = [researchRunRouterTracePath(cwd, trace.runId), ...(updateCurrent ? [currentRouterTracePath(cwd)] : [])];
  } else if (trace.turnId) {
    targets = [stateRouterTracePath(cwd, trace.turnId)];
  }
  for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(trace, null, 2)}\n`);
  }
  return trace;
}

export function readRouterTrace(cwd: string, runId?: string, turnId?: string): RouterTrace | null {
  const candidates = [runId ? researchRunRouterTracePath(cwd, runId) : "", runId ? currentRouterTracePath(cwd) : "", turnId ? stateRouterTracePath(cwd, turnId) : ""].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const trace = JSON.parse(readFileSync(candidate, "utf8")) as RouterTrace;
      if (runId && candidate === currentRouterTracePath(cwd)) {
        if ((trace.owner ?? "parent") === "subagent") continue;
        if (trace.runId !== runId) continue;
      }
      return trace;
    } catch {
      return null;
    }
  }
  return null;
}
