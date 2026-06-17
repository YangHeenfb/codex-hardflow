import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { hardflowRunCodexHome, researchRunCoveragePlanPath, researchRunEvidenceLedgerPath, researchRunReportPath, researchRunRouterTracePath } from "../paths.js";
import { internalEnvFor } from "../internalEnv.js";
import { completeHardflowJob, failHardflowJob, readHardflowJob, transitionHardflowJob, updateHardflowJob, claimHardflowJob, listPendingHardflowJobs } from "../jobs/jobStore.js";
import type { HardflowJob } from "../jobs/jobSchema.js";
import { runRouterProvider, type RouterProviderContext } from "../router/providers/index.js";
import { runResearch } from "../researchOrchestrator.js";
import { listSdkWorkerStates, type SdkResearchStepRunner } from "../research/sdkResearchRunner.js";
import type { RouterOutput } from "../router/routerSchema.js";

export interface RunJobOnceOptions {
  routerTimeoutMs?: number;
  codexCommand?: string;
  mockRouterOutput?: RouterOutput;
  sdkStepRunner?: SdkResearchStepRunner;
  sdkAvailable?: boolean;
}

function prepareDaemonCodexHome(cwd: string, runId: string): string {
  const codexHome = hardflowRunCodexHome(cwd, runId);
  mkdirSync(codexHome, { recursive: true });
  for (const forbidden of ["hooks.json", "AGENTS.md"]) {
    const target = `${codexHome}/${forbidden}`;
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  return codexHome;
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
      routerTracePath,
      isolatedCodexHome
    });
  }

  if (routeResult.output.route === "direct_answer" || routeResult.output.route === "bypass") {
    return completeHardflowJob(job.cwd, job.runId, {
      route: routeResult.output.route,
      routerTracePath,
      isolatedCodexHome,
      threadIds: []
    });
  }

  if (routeResult.output.route !== "research") {
    return completeHardflowJob(job.cwd, job.runId, {
      route: routeResult.output.route,
      routerTracePath,
      isolatedCodexHome,
      threadIds: []
    });
  }

  transitionHardflowJob(job.cwd, job.runId, "researching", { route: "research", routerTracePath, isolatedCodexHome }, "research_started");
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

export async function runPendingHardflowJobs(cwd: string, options: RunJobOnceOptions = {}): Promise<HardflowJob[]> {
  const results: HardflowJob[] = [];
  for (const job of listPendingHardflowJobs(cwd)) {
    results.push(await runHardflowJobOnce(cwd, job.runId, options));
  }
  return results;
}
