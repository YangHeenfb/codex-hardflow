import { hardflowRunCodexHome, researchRunCoveragePlanPath, researchRunEvidenceLedgerPath, researchRunReportPath, researchRunRouterTracePath } from "../paths.js";
import { internalEnvFor } from "../internalEnv.js";
import {
  activeSdkWorkerCount,
  claimHardflowJob,
  completeHardflowJob,
  failHardflowJob,
  listHardflowJobs,
  listPendingHardflowJobs,
  readHardflowJob,
  refreshHardflowQueueState,
  requestedWorkerCount,
  transitionHardflowJob,
  updateHardflowJob
} from "../jobs/jobStore.js";
import type { HardflowJob } from "../jobs/jobSchema.js";
import { runRouterProvider, type RouterProviderContext } from "../router/providers/index.js";
import { runResearch } from "../researchOrchestrator.js";
import { listSdkWorkerStates, type SdkResearchStepRunner } from "../research/sdkResearchRunner.js";
import type { RouterOutput } from "../router/routerSchema.js";
import { prepareIsolatedCodexHome } from "../codexHomeIsolation.js";
import { buildCoveragePlan } from "../coverage/coveragePlan.js";
import { DEFAULT_DAEMON_RUNTIME_CONFIG, type DaemonRuntimeConfig } from "../config.js";

export interface RunJobOnceOptions {
  routerTimeoutMs?: number;
  codexCommand?: string;
  mockRouterOutput?: RouterOutput;
  sdkStepRunner?: SdkResearchStepRunner;
  sdkAvailable?: boolean;
}

export interface RunPendingJobsOptions extends RunJobOnceOptions {
  daemonConfig?: Partial<DaemonRuntimeConfig>;
}

function prepareDaemonCodexHome(cwd: string, runId: string): string {
  const codexHome = hardflowRunCodexHome(cwd, runId);
  return prepareIsolatedCodexHome(codexHome);
}

async function withDaemonWorkerEnv<T>(cwd: string, runId: string, run: () => Promise<T>): Promise<T> {
  const isolatedCodexHome = prepareDaemonCodexHome(cwd, runId);
  const env = internalEnvFor(
    {
      ...process.env,
      CODEX_HOME: isolatedCodexHome
    },
    "daemon_worker",
    runId
  );
  const previous = {
    CODEX_HOME: process.env.CODEX_HOME,
    CODEX_HARDFLOW_INTERNAL: process.env.CODEX_HARDFLOW_INTERNAL,
    CODEX_HARDFLOW_INTERNAL_PURPOSE: process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE,
    CODEX_HARDFLOW_PARENT_RUN_ID: process.env.CODEX_HARDFLOW_PARENT_RUN_ID,
    CODEX_HARDFLOW_INTERNAL_DEPTH: process.env.CODEX_HARDFLOW_INTERNAL_DEPTH
  };
  for (const [key, value] of Object.entries(env)) {
    if (key === "CODEX_HOME" || key.startsWith("CODEX_HARDFLOW_INTERNAL") || key === "CODEX_HARDFLOW_PARENT_RUN_ID") {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function threadIdsForRun(cwd: string, runId: string): string[] {
  return listSdkWorkerStates(cwd, runId)
    .map((state) => state.threadId)
    .filter((threadId) => threadId.length > 0);
}

export async function processHardflowJob(job: HardflowJob, options: RunJobOnceOptions = {}): Promise<HardflowJob> {
  const isolatedCodexHome = prepareDaemonCodexHome(job.cwd, job.runId);
  updateHardflowJob(job.cwd, job.runId, { isolatedCodexHome, internalHookBypass: true }, "isolated_codex_home_prepared");
  transitionHardflowJob(job.cwd, job.runId, "routing", { isolatedCodexHome }, "routing_started");

  const routerContext: RouterProviderContext = {
    cwd: job.cwd,
    runId: job.runId,
    turnId: job.turnId,
    isolatedCodexHome,
    timeoutMs: options.routerTimeoutMs,
    codexCommand: options.codexCommand,
    mockOutput: options.mockRouterOutput
  };
  const routeResult = await runRouterProvider(
    job.routerProvider,
    {
      rawUserPrompt: job.rawUserPrompt,
      currentRunId: job.runId,
      triggerSource: job.triggerSource === "cli" ? "cli_command" : "hook_user_prompt_submit",
      programmaticTrigger: true
    },
    routerContext
  );

  const routerTracePath = researchRunRouterTracePath(job.cwd, job.runId);
  if (routeResult.output.route === "router_failed") {
    return failHardflowJob(job.cwd, job.runId, routeResult.trace.fallbackReason ?? routeResult.output.reasons[0] ?? "router failed", {
      route: "router_failed",
      researchScope: routeResult.output.researchScope,
      evidenceNeed: routeResult.output.evidenceNeed,
      routerTracePath,
      isolatedCodexHome
    });
  }

  if (routeResult.output.route === "direct_answer" || routeResult.output.route === "bypass") {
    return completeHardflowJob(job.cwd, job.runId, {
      route: routeResult.output.route,
      researchScope: routeResult.output.researchScope,
      evidenceNeed: routeResult.output.evidenceNeed,
      routerTracePath,
      isolatedCodexHome,
      threadIds: []
    });
  }

  if (routeResult.output.route !== "research") {
    return completeHardflowJob(job.cwd, job.runId, {
      route: routeResult.output.route,
      researchScope: routeResult.output.researchScope,
      evidenceNeed: routeResult.output.evidenceNeed,
      routerTracePath,
      isolatedCodexHome,
      threadIds: []
    });
  }

  const plannedWorkerCount = buildCoveragePlan(routeResult.output, job.rawUserPrompt, {
    runId: job.runId,
    coverageMode: job.coverageMode
  }).requiredBucketCount;
  transitionHardflowJob(
    job.cwd,
    job.runId,
    "researching",
    {
      route: "research",
      researchScope: routeResult.output.researchScope,
      evidenceNeed: routeResult.output.evidenceNeed,
      routerTracePath,
      isolatedCodexHome,
      priority: routeResult.output.researchScope === "local_diagnostic" ? "high" : job.priority,
      requestedWorkerCount: plannedWorkerCount,
      allocatedWorkerCount: Math.max(1, plannedWorkerCount)
    },
    "research_started"
  );
  const report = await withDaemonWorkerEnv(job.cwd, job.runId, () =>
    runResearch(job.rawUserPrompt, job.cwd, {
      rawUserPrompt: job.rawUserPrompt,
      normalizedTask: job.rawUserPrompt,
      runId: job.runId,
      runnerMode: "strict_programmatic",
      executeSdkResearch: true,
      strictProgrammatic: true,
      triggerSource: job.triggerSource === "cli" ? "cli_command" : "hook_user_prompt_submit",
      programmaticTrigger: true,
      coverageMode: job.coverageMode,
      parallelPolicy: job.parallelPolicy,
      routerOutput: routeResult.output,
      sdkStepRunner: options.sdkStepRunner,
      sdkAvailable: options.sdkAvailable,
      input: {
        turnId: job.turnId,
        triggerSource: job.triggerSource
      }
    })
  );
  if (report.status === "failed") {
    return failHardflowJob(job.cwd, job.runId, report.failure_reason ?? "strict research failed", {
      route: "research",
      researchScope: routeResult.output.researchScope,
      evidenceNeed: routeResult.output.evidenceNeed,
      routerTracePath,
      researchReportPath: researchRunReportPath(job.cwd, job.runId),
      coveragePlanPath: researchRunCoveragePlanPath(job.cwd, job.runId),
      evidenceLedgerPath: researchRunEvidenceLedgerPath(job.cwd, job.runId),
      isolatedCodexHome,
      threadIds: threadIdsForRun(job.cwd, job.runId)
    });
  }
  return completeHardflowJob(job.cwd, job.runId, {
    route: "research",
    researchScope: routeResult.output.researchScope,
    evidenceNeed: routeResult.output.evidenceNeed,
    routerTracePath,
    researchReportPath: researchRunReportPath(job.cwd, job.runId),
    coveragePlanPath: researchRunCoveragePlanPath(job.cwd, job.runId),
    evidenceLedgerPath: researchRunEvidenceLedgerPath(job.cwd, job.runId),
    isolatedCodexHome,
    threadIds: threadIdsForRun(job.cwd, job.runId)
  });
}

export async function runHardflowJobOnce(cwd: string, runId: string, options: RunJobOnceOptions = {}): Promise<HardflowJob> {
  const claimed = claimHardflowJob(cwd, runId);
  if (!claimed) {
    const existing = readHardflowJob(cwd, runId);
    if (!existing) throw new Error(`HardFlow job not found: ${runId}`);
    return existing;
  }
  try {
    return await processHardflowJob(claimed.job, options);
  } catch (error) {
    return failHardflowJob(cwd, runId, error instanceof Error ? error.message : String(error));
  } finally {
    claimed.release();
  }
}

export async function runPendingHardflowJobs(cwd: string, options: RunPendingJobsOptions = {}): Promise<HardflowJob[]> {
  const config = { ...DEFAULT_DAEMON_RUNTIME_CONFIG, ...(options.daemonConfig ?? {}) };
  refreshHardflowQueueState(cwd, config);
  const jobs = listHardflowJobs(cwd);
  let runningJobs = jobs.filter((job) => job.status === "routing" || job.status === "researching").length;
  let runningForeground = jobs.filter((job) => (job.status === "routing" || job.status === "researching") && job.foreground).length;
  let runningBackground = jobs.filter((job) => (job.status === "routing" || job.status === "researching") && !job.foreground).length;
  let activeWorkers = activeSdkWorkerCount(jobs);
  const selected: HardflowJob[] = [];
  for (const job of listPendingHardflowJobs(cwd)) {
    const requested = requestedWorkerCount(job);
    if (runningJobs >= config.maxConcurrentJobs) continue;
    if (job.foreground && runningForeground >= config.maxConcurrentForegroundJobs) continue;
    if (!job.foreground && runningBackground >= config.maxConcurrentBackgroundJobs) continue;
    if (activeWorkers + requested > config.maxGlobalSdkWorkers) continue;
    selected.push(job);
    runningJobs += 1;
    if (job.foreground) runningForeground += 1;
    else runningBackground += 1;
    activeWorkers += requested;
    updateHardflowJob(cwd, job.runId, { allocatedWorkerCount: requested }, "worker_budget_reserved");
  }
  const results: HardflowJob[] = [];
  for (const job of selected) {
    results.push(await runHardflowJobOnce(cwd, job.runId, options));
  }
  refreshHardflowQueueState(cwd, config);
  return results;
}
