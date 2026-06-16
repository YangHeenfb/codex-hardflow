import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { researchRunReportPath, researchRunRouterTracePath } from "../paths.js";
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

export function routeCommandArgs(runId: string, rawUserPrompt: string, timeoutMs: number): string[] {
  return ["route", "--run-id", runId, "--write-trace", "--timeout", String(timeoutMs), "--raw-user-prompt", rawUserPrompt, rawUserPrompt];
}

export function strictResearchCommandArgs(runId: string, rawUserPrompt: string): string[] {
  return ["research", "--strict-programmatic", "--coverage-mode", "exhaustive", "--parallel-policy", "all_required", "--run-id", runId, "--raw-user-prompt", rawUserPrompt, rawUserPrompt];
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => (/^[A-Za-z0-9_./:=@-]+$/.test(arg) ? arg : JSON.stringify(arg)))].join(" ");
}

export function defaultRoutePreflightRunner(request: RoutePreflightRequest): RoutePreflightResult {
  const args = routeCommandArgs(request.runId, request.rawUserPrompt, request.timeoutMs);
  const command = formatCommand(request.command, args);
  const result = spawnSync(request.command, args, {
    cwd: request.cwd,
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
        ? `route command exited with status ${result.status ?? "unknown"}: ${stderr.trim() || stdout.trim() || "no output"}`
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
    stdout,
    stderr,
    command
  };
}

export function defaultStrictResearchRunner(request: StrictResearchRequest): StrictResearchResult {
  const args = strictResearchCommandArgs(request.runId, request.rawUserPrompt);
  const command = formatCommand(request.command, args);
  const result = spawnSync(request.command, args, {
    cwd: request.cwd,
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
        ? `strict research command exited with status ${result.status ?? "unknown"}: ${stderr.trim() || stdout.trim() || "no output"}`
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
    stdout,
    stderr,
    command
  };
}
