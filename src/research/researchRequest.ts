import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { researchRunDir, researchRunRequestPath, researchRunRequestsDir, researchRunsDir, safeReportSegment } from "../paths.js";
import type { RouterOutput } from "../router/routerSchema.js";
import type { ResearchRequest, ResearchRequestRequestedBy, ResearchRequestStage, ResearchRequestStatus, ResearchRequestUrgency } from "../schemas.js";
import { runResearch, type RunResearchOptions } from "../researchOrchestrator.js";

export interface CreateResearchRequestInput {
  runId: string;
  requestId?: string;
  requestedBy: ResearchRequestRequestedBy;
  stage: ResearchRequestStage;
  reason: string;
  question: string;
  requiredBuckets?: string[];
  urgency?: ResearchRequestUrgency;
  contextRefs?: string[];
  relatedFiles?: string[];
}

export interface ResolveResearchRequestInput {
  runId: string;
  requestId: string;
  status?: Extract<ResearchRequestStatus, "resolved" | "failed" | "cancelled">;
  linkedResearchRunId?: string | null;
  failureReason?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requestIdFor(input: CreateResearchRequestInput): string {
  return safeReportSegment(input.requestId ?? `req-${Date.now()}-${input.question.slice(0, 40)}`);
}

function writeResearchRequest(cwd: string, request: ResearchRequest): ResearchRequest {
  const target = researchRunRequestPath(cwd, request.runId, request.requestId);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(request, null, 2)}\n`);
  return request;
}

export function createResearchRequest(cwd: string, input: CreateResearchRequestInput): ResearchRequest {
  const request: ResearchRequest = {
    requestId: requestIdFor(input),
    runId: input.runId,
    createdAt: nowIso(),
    requestedBy: input.requestedBy,
    stage: input.stage,
    reason: input.reason,
    question: input.question,
    requiredBuckets: input.requiredBuckets ?? [],
    urgency: input.urgency ?? "blocking",
    contextRefs: input.contextRefs ?? [],
    relatedFiles: input.relatedFiles ?? [],
    status: "pending",
    linkedResearchRunId: null
  };
  return writeResearchRequest(cwd, request);
}

export function loadResearchRequest(cwd: string, runId: string, requestId: string): ResearchRequest {
  const target = researchRunRequestPath(cwd, runId, requestId);
  if (!existsSync(target)) throw new Error(`ResearchRequest not found: runId=${runId} requestId=${requestId}`);
  return JSON.parse(readFileSync(target, "utf8")) as ResearchRequest;
}

function readRequest(path: string): ResearchRequest | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ResearchRequest;
  } catch {
    return null;
  }
}

export function listResearchRequests(cwd: string, runId?: string): ResearchRequest[] {
  const runIds = runId
    ? [runId]
    : existsSync(researchRunsDir(cwd))
      ? readdirSync(researchRunsDir(cwd), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];
  const requests: ResearchRequest[] = [];
  for (const id of runIds) {
    const dir = researchRunRequestsDir(cwd, id);
    if (!existsSync(dir) || !existsSync(researchRunDir(cwd, id))) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const request = readRequest(`${dir}/${file}`);
      if (request) requests.push(request);
    }
  }
  requests.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.requestId.localeCompare(b.requestId));
  return requests;
}

export function resolveResearchRequest(cwd: string, input: ResolveResearchRequestInput): ResearchRequest {
  const request = loadResearchRequest(cwd, input.runId, input.requestId);
  request.status = input.status ?? "resolved";
  if (input.linkedResearchRunId !== undefined) request.linkedResearchRunId = input.linkedResearchRunId;
  if (input.failureReason) request.failureReason = input.failureReason;
  request.resolvedAt = nowIso();
  return writeResearchRequest(cwd, request);
}

function researchProfileForBuckets(buckets: string[]): RouterOutput["researchProfile"] {
  if (buckets.includes("local_repo") && buckets.includes("competitors")) return "local_repo_plus_external";
  if (buckets.includes("competitors")) return "competitor";
  return "broad";
}

function routerOutputForRequest(request: ResearchRequest): RouterOutput {
  const sourceBuckets = request.requiredBuckets.map((bucket) => ({
    bucket: bucket as RouterOutput["sourceBuckets"][number]["bucket"],
    status: "required" as const,
    reason: `Required by ResearchRequest ${request.requestId}.`
  }));
  return {
    route: "research",
    workflowPattern: "parallel_research",
    researchProfile: researchProfileForBuckets(request.requiredBuckets),
    validationProfile: "none",
    sourceBuckets,
    requiredAgents: [],
    requiresSourceMatrix: true,
    requiresExecutorManifest: false,
    requiresValidation: false,
    requiresFinalHoldout: false,
    requiresParallelIsolation: false,
    reasons: [request.reason],
    risks: [],
    bypass: { requested: false, reason: "" }
  };
}

export async function runResearchRequest(cwd: string, runId: string, requestId: string, options: RunResearchOptions = {}): Promise<ResearchRequest> {
  const request = loadResearchRequest(cwd, runId, requestId);
  if (request.status === "resolved" || request.status === "cancelled") return request;
  request.status = "running";
  request.linkedResearchRunId = request.linkedResearchRunId ?? `${runId}-${request.requestId}-research`;
  writeResearchRequest(cwd, request);
  const report = await runResearch(request.question, cwd, {
    ...options,
    runId: request.linkedResearchRunId,
    rawUserPrompt: request.question,
    normalizedTask: request.question,
    routerOutput: routerOutputForRequest(request),
    strictProgrammatic: true,
    coverageMode: "exhaustive",
    parallelPolicy: "all_required",
    input: { turnId: request.linkedResearchRunId }
  });
  request.status = report.status === "completed" || report.status === "degraded" ? "resolved" : "failed";
  if (request.status === "failed") request.failureReason = report.failure_reason ?? "linked strict research failed";
  request.resolvedAt = request.status === "resolved" ? nowIso() : request.resolvedAt;
  return writeResearchRequest(cwd, request);
}

export function blockingResearchRequests(requests: ResearchRequest[]): ResearchRequest[] {
  return requests.filter((request) => request.urgency === "blocking" && (request.status === "pending" || request.status === "running"));
}

export function failedBlockingResearchRequests(requests: ResearchRequest[]): ResearchRequest[] {
  return requests.filter((request) => request.urgency === "blocking" && request.status === "failed");
}
