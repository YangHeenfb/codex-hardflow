import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hardflowJobEventsPath, hardflowJobLockPath, hardflowJobPath, hardflowJobsDir } from "../paths.js";
import { hashText } from "../hookState.js";
import type { RouterRoute } from "../router/routerSchema.js";
import type { HardflowJob, HardflowJobEvent, HardflowJobStatus, CreateHardflowJobInput } from "./jobSchema.js";
import { normalizeHardflowJob } from "./jobSchema.js";

function nowIso(): string {
  return new Date().toISOString();
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function createHardflowJob(input: CreateHardflowJobInput): HardflowJob {
  const createdAt = nowIso();
  const job: HardflowJob = {
    runId: input.runId,
    createdAt,
    updatedAt: createdAt,
    cwd: input.cwd,
    rawUserPrompt: input.rawUserPrompt,
    promptHash: input.promptHash || hashText(input.rawUserPrompt),
    turnId: input.turnId,
    triggerSource: input.triggerSource,
    programmaticTrigger: true,
    status: "pending",
    route: null,
    routerTracePath: null,
    researchReportPath: null,
    coveragePlanPath: null,
    evidenceLedgerPath: null,
    failureReason: null,
    routerProvider: input.routerProvider ?? "codex_cli",
    workerProvider: input.workerProvider ?? "codex_sdk",
    strict: true,
    coverageMode: "exhaustive",
    parallelPolicy: "all_required",
    threadIds: [],
    internalHookBypass: true
  };
  writeHardflowJob(job);
  appendHardflowJobEvent(input.cwd, { runId: input.runId, event: "created", status: "pending", route: null, createdAt });
  return job;
}

export function readHardflowJob(cwd: string, runId: string): HardflowJob | null {
  const path = hardflowJobPath(cwd, runId);
  if (!existsSync(path)) return null;
  try {
    return normalizeHardflowJob(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function writeHardflowJob(job: HardflowJob): HardflowJob {
  const next = { ...job, updatedAt: nowIso() };
  writeJson(hardflowJobPath(job.cwd, job.runId), next);
  return next;
}

export function updateHardflowJob(cwd: string, runId: string, patch: Partial<HardflowJob>, event?: string): HardflowJob {
  const current = readHardflowJob(cwd, runId);
  if (!current) throw new Error(`HardFlow job not found: ${runId}`);
  const next = writeHardflowJob({ ...current, ...patch });
  if (event) {
    appendHardflowJobEvent(cwd, {
      runId,
      event,
      status: next.status,
      route: next.route,
      createdAt: next.updatedAt,
      failureReason: next.failureReason
    });
  }
  return next;
}

export function listHardflowJobs(cwd: string): HardflowJob[] {
  const dir = hardflowJobsDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readHardflowJob(cwd, name.replace(/\.json$/, "")))
    .filter((job): job is HardflowJob => Boolean(job))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listPendingHardflowJobs(cwd: string): HardflowJob[] {
  return listHardflowJobs(cwd).filter((job) => job.status === "pending");
}

export function appendHardflowJobEvent(cwd: string, event: HardflowJobEvent): void {
  const path = hardflowJobEventsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export function transitionHardflowJob(cwd: string, runId: string, status: HardflowJobStatus, patch: Partial<HardflowJob> = {}, event: string = status): HardflowJob {
  return updateHardflowJob(cwd, runId, { ...patch, status }, event);
}

export function completeHardflowJob(
  cwd: string,
  runId: string,
  patch: {
    route: RouterRoute | null;
    routerTracePath?: string | null;
    researchReportPath?: string | null;
    coveragePlanPath?: string | null;
    evidenceLedgerPath?: string | null;
    isolatedCodexHome?: string;
    threadIds?: string[];
  }
): HardflowJob {
  return transitionHardflowJob(cwd, runId, "completed", { ...patch, failureReason: null }, "completed");
}

export function failHardflowJob(cwd: string, runId: string, failureReason: string, patch: Partial<HardflowJob> = {}): HardflowJob {
  return transitionHardflowJob(cwd, runId, "failed", { ...patch, failureReason }, "failed");
}

export interface ClaimedHardflowJob {
  job: HardflowJob;
  lockId: string;
  release: () => void;
}

export function claimHardflowJob(cwd: string, runId: string, owner = `${process.pid}-${randomUUID()}`): ClaimedHardflowJob | null {
  const job = readHardflowJob(cwd, runId);
  if (!job || job.status !== "pending") return null;
  const lockPath = hardflowJobLockPath(cwd, runId);
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, "wx");
    writeFileSync(fd, `${owner}\n`);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const claimed = updateHardflowJob(cwd, runId, { lockedAt: nowIso(), lockedBy: owner }, "claimed");
  return {
    job: claimed,
    lockId: owner,
    release: () => {
      rmSync(lockPath, { force: true });
    }
  };
}

export function cancelHardflowJob(cwd: string, runId: string, reason = "cancelled"): HardflowJob {
  return transitionHardflowJob(cwd, runId, "cancelled", { failureReason: reason }, "cancelled");
}
