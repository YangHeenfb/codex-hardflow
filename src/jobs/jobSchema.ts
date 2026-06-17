import type { CoverageMode, EvidenceNeed, ParallelPolicy, ResearchScope } from "../schemas.js";
import type { RouterRoute } from "../router/routerSchema.js";

export type HardflowJobTriggerSource = "hook_user_prompt_submit" | "cli";
export type HardflowJobStatus = "pending" | "routing" | "researching" | "completed" | "failed" | "cancelled";
export type HardflowJobPriority = "high" | "normal" | "low";
export type HardflowRouterProvider = "codex_cli" | "codex_sdk" | "openai_structured_output" | "local_model" | "mock";
export type HardflowWorkerProvider = "codex_sdk" | "codex_cli" | "source_adapters" | "mock";

export interface HardflowJob {
  runId: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  rawUserPrompt: string;
  promptHash: string;
  turnId: string;
  triggerSource: HardflowJobTriggerSource;
  programmaticTrigger: true;
  status: HardflowJobStatus;
  route: RouterRoute | null;
  researchScope: ResearchScope | null;
  evidenceNeed: EvidenceNeed | null;
  priority: HardflowJobPriority;
  queuePosition: number | null;
  estimatedStartAfterMs: number | null;
  foreground: boolean;
  currentUserTurn: boolean;
  requestedWorkerCount: number;
  allocatedWorkerCount: number;
  routerTracePath: string | null;
  researchReportPath: string | null;
  coveragePlanPath: string | null;
  evidenceLedgerPath: string | null;
  failureReason: string | null;
  routerProvider: HardflowRouterProvider;
  workerProvider: HardflowWorkerProvider;
  strict: true;
  coverageMode: CoverageMode;
  parallelPolicy: ParallelPolicy;
  isolatedCodexHome?: string;
  threadIds?: string[];
  internalHookBypass?: boolean;
  lockedAt?: string;
  lockedBy?: string;
}

export interface CreateHardflowJobInput {
  runId: string;
  cwd: string;
  rawUserPrompt: string;
  promptHash: string;
  turnId: string;
  triggerSource: HardflowJobTriggerSource;
  routerProvider?: HardflowRouterProvider;
  workerProvider?: HardflowWorkerProvider;
  priority?: HardflowJobPriority;
  foreground?: boolean;
  currentUserTurn?: boolean;
  requestedWorkerCount?: number;
}

export interface HardflowJobEvent {
  runId: string;
  event: string;
  status?: HardflowJobStatus;
  route?: RouterRoute | null;
  researchScope?: ResearchScope | null;
  evidenceNeed?: EvidenceNeed | null;
  createdAt: string;
  message?: string;
  failureReason?: string | null;
}

export function normalizeHardflowJob(value: unknown): HardflowJob | null {
  if (typeof value !== "object" || value === null) return null;
  const object = value as Partial<HardflowJob>;
  if (!object.runId || !object.cwd || !object.rawUserPrompt || !object.promptHash || !object.turnId) return null;
  const status = object.status ?? "pending";
  if (!["pending", "routing", "researching", "completed", "failed", "cancelled"].includes(status)) return null;
  const priority = object.priority === "high" || object.priority === "normal" || object.priority === "low" ? object.priority : object.currentUserTurn === false ? "normal" : "high";
  return {
    runId: object.runId,
    createdAt: object.createdAt ?? new Date().toISOString(),
    updatedAt: object.updatedAt ?? object.createdAt ?? new Date().toISOString(),
    cwd: object.cwd,
    rawUserPrompt: object.rawUserPrompt,
    promptHash: object.promptHash,
    turnId: object.turnId,
    triggerSource: object.triggerSource === "cli" ? "cli" : "hook_user_prompt_submit",
    programmaticTrigger: true,
    status,
    route: object.route ?? null,
    researchScope: object.researchScope ?? null,
    evidenceNeed: object.evidenceNeed ?? null,
    priority,
    queuePosition: typeof object.queuePosition === "number" ? object.queuePosition : null,
    estimatedStartAfterMs: typeof object.estimatedStartAfterMs === "number" ? object.estimatedStartAfterMs : null,
    foreground: typeof object.foreground === "boolean" ? object.foreground : object.triggerSource !== "cli",
    currentUserTurn: typeof object.currentUserTurn === "boolean" ? object.currentUserTurn : object.triggerSource !== "cli",
    requestedWorkerCount: typeof object.requestedWorkerCount === "number" ? Math.max(0, Math.floor(object.requestedWorkerCount)) : 0,
    allocatedWorkerCount: typeof object.allocatedWorkerCount === "number" ? Math.max(0, Math.floor(object.allocatedWorkerCount)) : 0,
    routerTracePath: object.routerTracePath ?? null,
    researchReportPath: object.researchReportPath ?? null,
    coveragePlanPath: object.coveragePlanPath ?? null,
    evidenceLedgerPath: object.evidenceLedgerPath ?? null,
    failureReason: object.failureReason ?? null,
    routerProvider: object.routerProvider ?? "codex_cli",
    workerProvider: object.workerProvider ?? "codex_sdk",
    strict: true,
    coverageMode: object.coverageMode ?? "exhaustive",
    parallelPolicy: object.parallelPolicy ?? "all_required",
    isolatedCodexHome: object.isolatedCodexHome,
    threadIds: Array.isArray(object.threadIds) ? object.threadIds.filter((item): item is string => typeof item === "string") : undefined,
    internalHookBypass: object.internalHookBypass,
    lockedAt: object.lockedAt,
    lockedBy: object.lockedBy
  };
}
