import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cliPathStatus } from "./cliPaths.js";
import { executorManifestPath, hardflowStateDir, repoHash, researchRunReportPath, validationSummaryPath } from "./paths.js";
import type { RouteStatus, TriggerSource } from "./schemas.js";

export type HookMarkerStatus = "active" | "completed" | "bypassed" | "expired";
export type HookTaskType = "router-preflight" | "research-heavy" | "implementation" | "validation-sensitive" | "hardflow-maintenance" | "bypass";

export interface HookMarker {
  turnId: string;
  runId: string;
  cwdHash: string;
  promptHash: string;
  taskType: HookTaskType;
  triggerSource: TriggerSource;
  programmaticTrigger: boolean;
  createdAt: string;
  expiresAt: string;
  status: HookMarkerStatus;
  requiresSourceMatrix: boolean;
  requiresExecutorManifest: boolean;
  requiresValidation: boolean;
  bypass: boolean;
  routeStatus?: RouteStatus;
  routerBlockCount?: number;
  routerTracePath?: string;
  routerRoute?: string;
  routerPreflightSource?: "user_prompt_submit" | "stop_hook";
  routerPreflightSucceeded?: boolean;
  routerPreflightFailureReason?: string;
  routerPreflightCompletedAt?: string;
  stopAutoRouteAttempted?: boolean;
  stopAutoRouteFailureReason?: string;
  strictResearchStopAttempted?: boolean;
  strictResearchStopFailureReason?: string;
  strictResearchAutoRunCompletedAt?: string;
  rawUserPrompt?: string;
  blockCount: number;
  maxBlocks: number;
  cwd: string;
  threadKey?: string;
  absoluteCommand: string;
  absoluteCliAvailable: boolean;
  wrapperAvailable: boolean;
  shellPathAvailable: boolean;
  appPathAvailable: boolean;
  expectedResearchReportPath: string;
  expectedExecutorManifestPath: string;
  expectedValidationSummaryPath: string;
}

export interface CreateHookMarkerOptions {
  cwd: string;
  prompt: string;
  sourceRoot: string;
  taskType: HookTaskType;
  requiresSourceMatrix: boolean;
  requiresExecutorManifest: boolean;
  requiresValidation: boolean;
  bypass?: boolean;
  routeStatus?: RouteStatus;
  input?: Record<string, unknown>;
  now?: Date;
  ttlMs?: number;
  maxBlocks?: number;
  runId?: string;
  triggerSource?: TriggerSource;
  programmaticTrigger?: boolean;
}

interface ThreadIndex {
  turnId: string;
  promptHash: string;
  updatedAt: string;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BLOCKS = 2;

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

function stringAt(input: Record<string, unknown>, path: string): string | undefined {
  let current: unknown = input;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : undefined;
}

function firstString(input: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = stringAt(input, path);
    if (value) return value;
  }
  return undefined;
}

function explicitTurnId(input: Record<string, unknown>): string | undefined {
  return firstString(input, ["turn_id", "turnId", "turnID", "request_id", "requestId", "submission_id", "submissionId", "turn.id", "hardflowTurnId", "hardflow_turn_id"]);
}

function explicitRunId(input: Record<string, unknown>): string | undefined {
  return firstString(input, ["run_id", "runId", "hardflowRunId", "hardflow_run_id"]);
}

function threadKey(input: Record<string, unknown>): string | undefined {
  const raw = firstString(input, ["thread_id", "threadId", "conversation_id", "conversationId", "session_id", "sessionId", "transcript_path", "transcriptPath"]);
  return raw ? hashText(raw) : undefined;
}

function markerDir(cwdHash: string, turnId: string): string {
  return join(hardflowStateDir(), cwdHash, safeSegment(turnId));
}

export function markerPathFor(cwdHash: string, turnId: string): string {
  return join(markerDir(cwdHash, turnId), "hook_state.json");
}

function threadIndexPath(cwdHash: string, key: string): string {
  return join(hardflowStateDir(), cwdHash, "threads", `${safeSegment(key)}.json`);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeMarker(marker: HookMarker): void {
  const path = markerPathFor(marker.cwdHash, marker.turnId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`);
}

function writeThreadIndex(marker: HookMarker): void {
  if (!marker.threadKey) return;
  const path = threadIndexPath(marker.cwdHash, marker.threadKey);
  mkdirSync(dirname(path), { recursive: true });
  const index: ThreadIndex = {
    turnId: marker.turnId,
    promptHash: marker.promptHash,
    updatedAt: new Date().toISOString()
  };
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`);
}

export function createHookMarker(options: CreateHookMarkerOptions): HookMarker {
  const input = options.input ?? {};
  const cwd = resolve(options.cwd);
  const cwdHash = repoHash(cwd);
  const promptHash = hashText(options.prompt);
  const createdAt = (options.now ?? new Date()).toISOString();
  const turnId = explicitTurnId(input)
    ? safeSegment(explicitTurnId(input) ?? "")
    : safeSegment(`${cwdHash}-${promptHash}-${hashText(createdAt)}`);
  const runId = safeSegment(options.runId ?? explicitRunId(input) ?? `run-${turnId}`);
  const pathStatus = cliPathStatus(options.sourceRoot);
  const marker: HookMarker = {
    turnId,
    runId,
    cwdHash,
    promptHash,
    taskType: options.taskType,
    triggerSource: options.triggerSource ?? "unknown",
    programmaticTrigger: options.programmaticTrigger ?? false,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + (options.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    status: options.bypass ? "bypassed" : "active",
    requiresSourceMatrix: options.requiresSourceMatrix,
    requiresExecutorManifest: options.requiresExecutorManifest,
    requiresValidation: options.requiresValidation,
    bypass: options.bypass === true,
    routeStatus: options.routeStatus,
    routerBlockCount: 0,
    rawUserPrompt: options.prompt,
    blockCount: 0,
    maxBlocks: options.maxBlocks ?? DEFAULT_MAX_BLOCKS,
    cwd,
    threadKey: threadKey(input),
    absoluteCommand: pathStatus.absoluteCommand,
    absoluteCliAvailable: pathStatus.absoluteCliAvailable,
    wrapperAvailable: pathStatus.wrapperAvailable,
    shellPathAvailable: pathStatus.shellPathAvailable,
    appPathAvailable: pathStatus.appPathAvailable,
    expectedResearchReportPath: researchRunReportPath(cwd, runId),
    expectedExecutorManifestPath: executorManifestPath(cwd),
    expectedValidationSummaryPath: validationSummaryPath(cwd)
  };
  writeMarker(marker);
  writeThreadIndex(marker);
  return marker;
}

function markerFromExplicitTurn(cwdHash: string, input: Record<string, unknown>): HookMarker | null {
  const turnId = explicitTurnId(input);
  if (!turnId) return null;
  return readJson<HookMarker>(markerPathFor(cwdHash, safeSegment(turnId)));
}

function markerFromThreadIndex(cwdHash: string, input: Record<string, unknown>): HookMarker | null {
  const key = threadKey(input);
  if (!key) return null;
  const index = readJson<ThreadIndex>(threadIndexPath(cwdHash, key));
  if (!index) return null;
  return readJson<HookMarker>(markerPathFor(cwdHash, index.turnId));
}

function markerFromPromptHash(cwdHash: string, input: Record<string, unknown>): HookMarker | null {
  const promptHash = firstString(input, ["promptHash", "prompt_hash"]);
  const createdAt = firstString(input, ["createdAt", "created_at", "markerCreatedAt", "hardflowCreatedAt", "hardflow_created_at"]);
  if (!promptHash || !createdAt) return null;
  const root = join(hardflowStateDir(), cwdHash);
  if (!existsSync(root)) return null;
  const matches = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "threads")
    .map((entry) => readJson<HookMarker>(join(root, entry.name, "hook_state.json")))
    .filter((marker): marker is HookMarker => marker?.promptHash === promptHash && marker.createdAt === createdAt);
  matches.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return matches[0] ?? null;
}

export function resolveCurrentMarker(input: Record<string, unknown> = {}, cwd = process.cwd()): HookMarker | null {
  const cwdHash = repoHash(resolve(cwd));
  return markerFromExplicitTurn(cwdHash, input) ?? markerFromThreadIndex(cwdHash, input) ?? markerFromPromptHash(cwdHash, input);
}

export function resolveLatestActiveMarker(cwd = process.cwd()): HookMarker | null {
  const cwdHash = repoHash(resolve(cwd));
  const root = join(hardflowStateDir(), cwdHash);
  if (!existsSync(root)) return null;
  const markers = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "threads")
    .map((entry) => readJson<HookMarker>(join(root, entry.name, "hook_state.json")))
    .filter((marker): marker is HookMarker => marker !== null && marker.status === "active" && !markerExpired(marker) && typeof marker.runId === "string");
  markers.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return markers[0] ?? null;
}

export function markerExpired(marker: HookMarker, now = new Date()): boolean {
  return Date.parse(marker.expiresAt) <= now.getTime();
}

export function updateMarker(marker: HookMarker, patch: Partial<HookMarker>): HookMarker {
  const next = { ...marker, ...patch };
  writeMarker(next);
  writeThreadIndex(next);
  return next;
}

export function incrementBlockCount(marker: HookMarker): HookMarker {
  return updateMarker(marker, { blockCount: marker.blockCount + 1 });
}
