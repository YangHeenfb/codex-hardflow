import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DAEMON_RUNTIME_CONFIG, type DaemonRuntimeConfig } from "../config.js";
import { hardflowDaemonPidPath, hardflowDaemonStopPath, hardflowJobEventsPath } from "../paths.js";
import { listHardflowJobs } from "../jobs/jobStore.js";
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
  completedJobs: number;
  failedJobs: number;
  jobEventsPath: string;
}

export function daemonStatus(cwd: string): DaemonStatus {
  const jobs = listHardflowJobs(cwd);
  const pidPath = hardflowDaemonPidPath(cwd);
  return {
    enabled: true,
    pidPath,
    stopPath: hardflowDaemonStopPath(cwd),
    pid: existsSync(pidPath) ? Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10) || null : null,
    stopRequested: existsSync(hardflowDaemonStopPath(cwd)),
    pendingJobs: jobs.filter((job) => job.status === "pending").length,
    runningJobs: jobs.filter((job) => job.status === "routing" || job.status === "researching").length,
    completedJobs: jobs.filter((job) => job.status === "completed").length,
    failedJobs: jobs.filter((job) => job.status === "failed").length,
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
      await runPendingHardflowJobs(cwd);
      await sleep(resolved.pollIntervalMs);
    }
  } finally {
    rmSync(pidPath, { force: true });
  }
  return daemonStatus(cwd);
}
