import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { internalEnvFor } from "../internalEnv.js";
import { researchRunHookInputPath, researchRunReportPath, researchRunRouterTracePath } from "../paths.js";
import type { ResearchReport } from "../schemas.js";
import type { RouterTrace } from "../router/routerSchema.js";

const SPAWN_TIMEOUT_GRACE_MS = 5_000;
const MAX_HOOK_COMMAND_BUFFER = 20 * 1024 * 1024;

export interface RoutePreflightRequest {
  cwd: string;
  command: string;
  runId: string;
  rawUserPrompt: string;
  timeoutMs: number;
  turnId?: string;
  inputJsonPath?: string;
  triggerSource?: HookInputJson["triggerSource"];
}

export interface RoutePreflightResult {
  succeeded: boolean;
  trace?: RouterTrace;
  tracePath: string;
  route?: string;
  failureReason?: string;
  timedOut?: boolean;
  status?: number | null;
  stdout?: string;
  stderr?: string;
  command: string;
}

export type RoutePreflightRunner = (request: RoutePreflightRequest) => RoutePreflightResult;

export interface StrictResearchRequest {
  cwd: string;
  command: string;
  runId: string;
  rawUserPrompt: string;
  timeoutMs: number;
  turnId?: string;
  inputJsonPath?: string;
}

export interface StrictResearchResult {
  succeeded: boolean;
  report?: ResearchReport;
  reportPath: string;
  failureReason?: string;
  timedOut?: boolean;
  status?: number | null;
  stdout?: string;
  stderr?: string;
  command: string;
}

export type StrictResearchRunner = (request: StrictResearchRequest) => StrictResearchResult;

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export interface HookInputJson {
  rawUserPrompt: string;
  turnId?: string;
  cwd: string;
  sourceRoot?: string;
  triggerSource: "hook_user_prompt_submit" | "stop_hook";
  runId: string;
}

export function writeHookInputJson(cwd: string, runId: string, input: HookInputJson): string {
  const target = researchRunHookInputPath(cwd, runId);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(input, null, 2)}\n`);
  return target;
}

function ensureInputJsonPath(request: RoutePreflightRequest | StrictResearchRequest, triggerSource: HookInputJson["triggerSource"]): string {
  if (request.inputJsonPath && existsSync(request.inputJsonPath)) return request.inputJsonPath;
  return writeHookInputJson(request.cwd, request.runId, {
    runId: request.runId,
    rawUserPrompt: request.rawUserPrompt,
    turnId: request.turnId,
    cwd: request.cwd,
    triggerSource
  });
}

function sanitizeOutput(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 4000);
}

export function routeCommandArgs(runId: string, rawUserPrompt: string, timeoutMs: number, inputJsonPath?: string): string[] {
  if (inputJsonPath) return ["route", "--run-id", runId, "--write-trace", "--timeout", String(timeoutMs), "--input-json", inputJsonPath];
  return ["route", "--run-id", runId, "--write-trace", "--timeout", String(timeoutMs), "--raw-user-prompt", rawUserPrompt, rawUserPrompt];
}

export function strictResearchCommandArgs(runId: string, rawUserPrompt: string, inputJsonPath?: string): string[] {
  if (inputJsonPath) {
    return ["research", "--strict-programmatic", "--coverage-mode", "exhaustive", "--parallel-policy", "all_required", "--run-id", runId, "--input-json", inputJsonPath];
  }
  return ["research", "--strict-programmatic", "--coverage-mode", "exhaustive", "--parallel-policy", "all_required", "--run-id", runId, "--raw-user-prompt", rawUserPrompt, rawUserPrompt];
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => (/^[A-Za-z0-9_./:=@-]+$/.test(arg) ? arg : JSON.stringify(arg)))].join(" ");
}

export function defaultRoutePreflightRunner(request: RoutePreflightRequest): RoutePreflightResult {
  const inputJsonPath = ensureInputJsonPath(request, request.triggerSource ?? "hook_user_prompt_submit");
  const args = routeCommandArgs(request.runId, request.rawUserPrompt, request.timeoutMs, inputJsonPath);
  const command = formatCommand(request.command, args);
  let env: NodeJS.ProcessEnv;
  try {
    env = internalEnvFor(process.env, "router", request.runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      succeeded: false,
      tracePath: researchRunRouterTracePath(request.cwd, request.runId),
      failureReason: message,
      command
    };
  }
  const result = spawnSync(request.command, args, {
    cwd: request.cwd,
    env,
    encoding: "utf8",
    timeout: request.timeoutMs + SPAWN_TIMEOUT_GRACE_MS,
    maxBuffer: MAX_HOOK_COMMAND_BUFFER
  });
  const tracePath = researchRunRouterTracePath(request.cwd, request.runId);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const trace = parseJson<RouterTrace>(stdout) ?? readJsonFile<RouterTrace>(tracePath) ?? undefined;
  const timedOut = Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT");
  const failureReason = timedOut
    ? `route preflight timed out after ${request.timeoutMs}ms`
    : result.error
      ? result.error.message
      : result.status !== 0
        ? `route command exited with status ${result.status ?? "unknown"}: ${sanitizeOutput(stderr) || sanitizeOutput(stdout) || "no output"}`
        : !trace
          ? "route command did not produce a readable router_trace."
          : trace.route === "router_failed"
            ? trace.fallbackReason || trace.reasons?.[0] || "router returned router_failed."
            : undefined;
  return {
    succeeded: !failureReason,
    trace,
    tracePath,
    route: trace?.route,
    failureReason,
    timedOut,
    status: result.status,
    stdout: sanitizeOutput(stdout),
    stderr: sanitizeOutput(stderr),
    command
  };
}

export function defaultStrictResearchRunner(request: StrictResearchRequest): StrictResearchResult {
  const inputJsonPath = ensureInputJsonPath(request, "stop_hook");
  const args = strictResearchCommandArgs(request.runId, request.rawUserPrompt, inputJsonPath);
  const command = formatCommand(request.command, args);
  let env: NodeJS.ProcessEnv;
  try {
    env = internalEnvFor(process.env, "strict_research", request.runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      succeeded: false,
      reportPath: researchRunReportPath(request.cwd, request.runId),
      failureReason: message,
      command
    };
  }
  const result = spawnSync(request.command, args, {
    cwd: request.cwd,
    env,
    encoding: "utf8",
    timeout: request.timeoutMs + SPAWN_TIMEOUT_GRACE_MS,
    maxBuffer: MAX_HOOK_COMMAND_BUFFER
  });
  const reportPath = researchRunReportPath(request.cwd, request.runId);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const report = parseJson<ResearchReport>(stdout) ?? readJsonFile<ResearchReport>(reportPath) ?? undefined;
  const timedOut = Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT");
  const failureReason = timedOut
    ? `strict research timed out after ${request.timeoutMs}ms`
    : result.error
      ? result.error.message
      : result.status !== 0
        ? `strict research command exited with status ${result.status ?? "unknown"}: ${sanitizeOutput(stderr) || sanitizeOutput(stdout) || "no output"}`
        : report?.status === "failed"
          ? report.failure_reason || "strict research report status=failed without failure_reason."
          : !report
            ? "strict research command did not produce a readable research_report."
            : undefined;
  return {
    succeeded: !failureReason,
    report,
    reportPath,
    failureReason,
    timedOut,
    status: result.status,
    stdout: sanitizeOutput(stdout),
    stderr: sanitizeOutput(stderr),
    command
  };
}
