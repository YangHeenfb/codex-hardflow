import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RoutePreflightRunner, StrictResearchRunner } from "../src/hooks/hookAutomation.js";
import { researchRunReportPath, researchRunRouterTracePath } from "../src/paths.js";
import { buildResearchReport } from "../src/researchOrchestrator.js";
import { buildRouterTrace, writeRouterTrace } from "../src/router/routerTrace.js";
import type { RouterOutput } from "../src/router/routerSchema.js";

export function fakeRouteRunner(output: RouterOutput, succeeded = true): RoutePreflightRunner {
  return (request) => {
    const trace = buildRouterTrace(
      {
        rawUserPrompt: request.rawUserPrompt,
        currentRunId: request.runId,
        triggerSource: "hook_user_prompt_submit",
        programmaticTrigger: true
      },
      output,
      output.route === "router_failed" ? "router_failed" : "llm",
      output.route === "router_failed" ? output.reasons[0] : undefined,
      undefined,
      { triggerSource: "hook_user_prompt_submit", programmaticTrigger: true }
    );
    writeRouterTrace(request.cwd, trace, true);
    return {
      succeeded: succeeded && output.route !== "router_failed",
      trace,
      tracePath: researchRunRouterTracePath(request.cwd, request.runId),
      route: output.route,
      failureReason: succeeded && output.route !== "router_failed" ? undefined : output.reasons[0] ?? "fake route failed",
      command: "fake route"
    };
  };
}

export function failingRouteRunner(reason: string): RoutePreflightRunner {
  return (request) => ({
    succeeded: false,
    tracePath: researchRunRouterTracePath(request.cwd, request.runId),
    failureReason: reason,
    command: "fake route"
  });
}

export function fakeStrictResearchRunner(status: "completed" | "failed" = "completed"): StrictResearchRunner {
  return (request) => {
    const report = buildResearchReport(request.rawUserPrompt, [], "not_configured", {
      runId: request.runId,
      runnerMode: "strict_programmatic",
      triggerSource: "hook_user_prompt_submit",
      programmaticTrigger: true,
      routerOutput: undefined
    });
    report.status = status;
    report.failure_reason = status === "failed" ? "fake strict research failed" : undefined;
    const path = researchRunReportPath(request.cwd, request.runId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    return {
      succeeded: status === "completed",
      report,
      reportPath: path,
      failureReason: status === "failed" ? "fake strict research failed" : undefined,
      command: "fake strict research"
    };
  };
}
