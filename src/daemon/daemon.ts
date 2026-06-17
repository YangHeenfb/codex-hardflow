import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DAEMON_RUNTIME_CONFIG, type DaemonRuntimeConfig } from "../config.js";
import { hardflowDaemonPidPath, hardflowDaemonStopPath, hardflowJobEventsPath } from "../paths.js";
import { listHardflowJobs, refreshHardflowQueueState, requestedWorkerCount } from "../jobs/jobStore.js";
import { runPendingHardflowJobs } from "./jobRunner.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DaemonStatus {
  enabled: boolean;
  pidPath: string;
  stopPath: string;
  pid: number | null;
  stopRequested: boolean;
  pendingJobs: number;
  runningJobs: number;
  queuedJobs: number;
  completedJobs: number;
  failedJobs: number;
  maxConcurrentJobs: number;
  maxConcurrentForegroundJobs: number;
  maxConcurrentBackgroundJobs: number;
  maxGlobalSdkWorkers: number;
  activeSdkWorkers: number;
  availableSdkWorkers: number;
  nextJobs: Array<{
    runId: string;
    status: string;
    priority: string;
    foreground: boolean;
    queuePosition: number | null;
    estimatedStartAfterMs: number | null;
    requestedWorkerCount: number;
  }>;
  jobEventsPath: string;
}

export function daemonStatus(cwd: string, config: Partial<DaemonRuntimeConfig> = {}): DaemonStatus {
  const resolved = { ...DEFAULT_DAEMON_RUNTIME_CONFIG, ...config };
  const queue = refreshHardflowQueueState(cwd, resolved);
  const jobs = listHardflowJobs(cwd);
  const pidPath = hardflowDaemonPidPath(cwd);
  const pendingJobs = queue.pending;
  return {
    enabled: true,
    pidPath,
    stopPath: hardflowDaemonStopPath(cwd),
    pid: existsSync(pidPath) ? Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10) || null : null,
    stopRequested: existsSync(hardflowDaemonStopPath(cwd)),
    pendingJobs: pendingJobs.length,
    runningJobs: jobs.filter((job) => job.status === "routing" || job.status === "researching").length,
    queuedJobs: pendingJobs.filter((job) => (job.queuePosition ?? 0) > resolved.maxConcurrentJobs || requestedWorkerCount(job) > queue.availableSdkWorkers).length,
    completedJobs: jobs.filter((job) => job.status === "completed").length,
    failedJobs: jobs.filter((job) => job.status === "failed").length,
    maxConcurrentJobs: resolved.maxConcurrentJobs,
    maxConcurrentForegroundJobs: resolved.maxConcurrentForegroundJobs,
    maxConcurrentBackgroundJobs: resolved.maxConcurrentBackgroundJobs,
    maxGlobalSdkWorkers: resolved.maxGlobalSdkWorkers,
    activeSdkWorkers: queue.activeSdkWorkers,
    availableSdkWorkers: queue.availableSdkWorkers,
    nextJobs: pendingJobs.slice(0, 5).map((job) => ({
      runId: job.runId,
      status: job.status,
      priority: job.priority,
      foreground: job.foreground,
      queuePosition: job.queuePosition,
      estimatedStartAfterMs: job.estimatedStartAfterMs,
      requestedWorkerCount: requestedWorkerCount(job)
    })),
    jobEventsPath: hardflowJobEventsPath(cwd)
  };
}

export function stopDaemon(cwd: string): DaemonStatus {
  const stopPath = hardflowDaemonStopPath(cwd);
  mkdirSync(dirname(stopPath), { recursive: true });
  writeFileSync(stopPath, `${new Date().toISOString()}\n`);
  return daemonStatus(cwd);
}

export async function runDaemon(cwd: string, config: Partial<DaemonRuntimeConfig> = {}): Promise<DaemonStatus> {
  const resolved = { ...DEFAULT_DAEMON_RUNTIME_CONFIG, ...config };
  const pidPath = hardflowDaemonPidPath(cwd);
  const stopPath = hardflowDaemonStopPath(cwd);
  mkdirSync(dirname(pidPath), { recursive: true });
  rmSync(stopPath, { force: true });
  writeFileSync(pidPath, `${process.pid}\n`);
  try {
    while (!existsSync(stopPath)) {
      await runPendingHardflowJobs(cwd, { daemonConfig: resolved });
      await sleep(resolved.pollIntervalMs);
    }
  } finally {
    rmSync(pidPath, { force: true });
  }
  return daemonStatus(cwd);
}
