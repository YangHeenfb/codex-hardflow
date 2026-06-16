import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cliPathStatus } from "./cliPaths.js";
import { codexRunnerStatus } from "./codexRunner.js";
import { installGlobal, SDK_VERSION } from "./config.js";
import { evaluateCoverage } from "./coverageEval.js";
import { parseCsv, parseNumberCsv, runDiagnostics, type DiagnosticsCommand } from "./diagnostics/sdkDiagnostics.js";
import { requireExecutorManifest } from "./executionOrchestrator.js";
import { parseFlagArgs, type ParsedFlags } from "./flagParser.js";
import { appendHookEvent, assertHookActive, hookStatus } from "./hookEvents.js";
import { cleanWorkspaceStrategy, hasHeadCommit } from "./gitUtils.js";
import { stopValidationGate } from "./hooks/stopValidationGate.js";
import { preToolUsePrivatePathGuard } from "./hooks/preToolUsePrivatePathGuard.js";
import { subagentStartContext } from "./hooks/subagentStartContext.js";
import { subagentStopLoopGate } from "./hooks/subagentStopLoopGate.js";
import { userPromptSubmit } from "./hooks/userPromptSubmit.js";
import { planParallelModules } from "./parallelOrchestrator.js";
import { codexHome, privateStoreRoot, skillPathStrategy, validationSummaryPath } from "./paths.js";
import { runLogprobsProbe } from "./probes/logprobsProbe.js";
import {
  addManualSourceToReport,
  addSubagentReport,
  assertResearchReportEvidence,
  cancelResearchWorker,
  finalizeManualReport,
  listResearchWorkers,
  loadResearchReport,
  mergeSubagentReports,
  researchReportSummary,
  resumeResearchRun,
  runResearch
} from "./researchOrchestrator.js";
import {
  createResearchRequest,
  listResearchRequests,
  resolveResearchRequest,
  runResearchRequest
} from "./research/researchRequest.js";
import { runLlmRouter } from "./router/llmRouter.js";
import type { RouterTraceOwner } from "./router/routerSchema.js";
import type {
  Confidence,
  CoverageMode,
  ParallelPolicy,
  ResearchRequestRequestedBy,
  ResearchRequestStage,
  ResearchRequestStatus,
  ResearchRequestUrgency,
  ResearchRunnerMode,
  ResearchSource,
  SubagentReportStatus
} from "./schemas.js";
import { validate } from "./validationOrchestrator.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string; dependencies?: Record<string, string> };
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntrypointUsed = fileURLToPath(import.meta.url);

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function stringFlag(flags: ParsedFlags, key: string, required = false): string | undefined {
  const value = flags[key];
  if (typeof value === "string") return value;
  if (required) throw new Error(`Missing --${key}`);
  return undefined;
}

function numberFlag(flags: ParsedFlags, key: string): number | undefined {
  const value = stringFlag(flags, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid --${key}: ${value}`);
  return parsed;
}

function booleanFlag(flags: ParsedFlags, key: string): boolean {
  const value = flags[key];
  return value === true || value === "true" || value === "1";
}

function validRunnerMode(value: string | undefined): value is ResearchRunnerMode {
  return value === "app_handoff" || value === "sdk_threads" || value === "strict_programmatic" || value === "manual_fallback" || value === "mixed";
}

function coverageModeFlag(value: string | undefined): CoverageMode | undefined {
  if (value === undefined) return undefined;
  if (value === "exhaustive" || value === "balanced" || value === "fast") return value;
  throw new Error(`Invalid --coverage-mode: ${value}`);
}

function parallelPolicyFlag(value: string | undefined): ParallelPolicy | undefined {
  if (value === undefined) return undefined;
  if (value === "all_required" || value === "fixed" || value === "adaptive" || value === "wave") return value;
  throw new Error(`Invalid --parallel-policy: ${value}`);
}

function requestedByFlag(value: string | undefined): ResearchRequestRequestedBy {
  if (value === "planner" || value === "executor" || value === "validator" || value === "reviewer" || value === "stop_hook") return value;
  if (value === undefined) return "executor";
  throw new Error(`Invalid --requested-by: ${value}`);
}

function requestStageFlag(value: string | undefined): ResearchRequestStage {
  if (value === "planning" || value === "execution" || value === "validation" || value === "review" || value === "repair") return value;
  if (value === undefined) return "execution";
  throw new Error(`Invalid --stage: ${value}`);
}

function requestUrgencyFlag(value: string | undefined): ResearchRequestUrgency {
  if (value === "blocking" || value === "non_blocking") return value;
  if (value === undefined) return "blocking";
  throw new Error(`Invalid --urgency: ${value}`);
}

function requestResolveStatusFlag(value: string | undefined): Extract<ResearchRequestStatus, "resolved" | "failed" | "cancelled"> | undefined {
  if (value === undefined) return undefined;
  if (value === "resolved" || value === "failed" || value === "cancelled") return value;
  throw new Error(`Invalid --status for request resolve: ${value}`);
}

function validDiagnosticsCommand(value: string | undefined): value is DiagnosticsCommand {
  return value === "sdk-concurrency" || value === "sdk-prompt-width" || value === "sdk-bucket-difficulty" || value === "sdk-timeout-sweep" || value === "sdk-checkpoint-resume";
}

function routerOwnerFlag(value: string | undefined): RouterTraceOwner {
  if (value === undefined) return "parent";
  if (value === "parent" || value === "subagent") return value;
  throw new Error(`Invalid --owner: ${value}`);
}

async function readStdinJson(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

async function readOptionalStdinJson(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  return readStdinJson();
}

function stringField(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function stringArrayField(input: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (typeof value === "string" && value.trim().length > 0) return [value];
  }
  return undefined;
}

function sourceArrayField(input: Record<string, unknown>, keys: string[]): ResearchSource[] | undefined {
  for (const key of keys) {
    const value = input[key];
    if (!Array.isArray(value)) continue;
    return value.filter((item): item is ResearchSource => typeof item === "object" && item !== null && "title" in item && "url_or_ref" in item && "claim" in item);
  }
  return undefined;
}

function pickString(flags: ParsedFlags, input: Record<string, unknown>, flagKeys: string[], jsonKeys: string[], required = false): string | undefined {
  for (const flag of flagKeys) {
    const value = stringFlag(flags, flag);
    if (value) return value;
  }
  const value = stringField(input, jsonKeys);
  if (!value && required) throw new Error(`Missing --${flagKeys[0]}`);
  return value;
}

function pickStringArray(flags: ParsedFlags, input: Record<string, unknown>, flagKey: string, jsonKeys: string[]): string[] | undefined {
  const fromFlag = stringFlag(flags, flagKey);
  const fromJson = stringArrayField(input, jsonKeys) ?? [];
  return fromFlag ? [...fromJson, fromFlag] : fromJson.length > 0 ? fromJson : undefined;
}

function validSubagentStatus(value: string | undefined): value is SubagentReportStatus {
  return value === "completed" || value === "timeout" || value === "failed" || value === "searched_but_no_signal";
}

function sdkProgress(event: { agent: string; bucket: string; status: string; message: string }): void {
  process.stderr.write(`[codex-hardflow] ${event.agent}/${event.bucket}: ${event.status} - ${event.message}\n`);
}

export function status(cwd: string, root = sourceRoot): Record<string, unknown> {
  const codexVersion = spawnSync("codex", ["--version"], { encoding: "utf8" });
  const strategy = skillPathStrategy();
  const pathStatus = cliPathStatus(root);
  return {
    sourceRoot: root,
    distPath: resolve(root, "dist", "cli.js"),
    binPath: resolve(root, "bin", "codex-hardflow"),
    cliEntrypointUsed,
    packageVersion: packageJson.version,
    codexCli: codexVersion.status === 0 ? codexVersion.stdout.trim() : "unavailable",
    absoluteCliAvailable: pathStatus.absoluteCliAvailable,
    wrapperAvailable: pathStatus.wrapperAvailable,
    wrapperConflict: pathStatus.wrapperConflict,
    shellPathAvailable: pathStatus.shellPathAvailable,
    appPathAvailable: pathStatus.appPathAvailable,
    absoluteCommand: pathStatus.absoluteCommand,
    wrapperPath: pathStatus.wrapperPath,
    globalWrapperPath: pathStatus.globalWrapperPath,
    globalWrapperTarget: pathStatus.globalWrapperTarget,
    wrapperPointsToCurrentSourceRoot: pathStatus.wrapperPointsToCurrentSourceRoot,
    wrapperVersion: pathStatus.wrapperVersion,
    sdk: codexRunnerStatus(),
    sdkPinned: packageJson.dependencies?.["@openai/codex-sdk"] === SDK_VERSION,
    codexHome: codexHome(),
    hooksJsonExists: existsSync(resolve(codexHome(), "hooks.json")),
    canonicalSkillExists: strategy.canonicalExists,
    legacySkillExists: strategy.legacyExists,
    privateStoreConfigured: existsSync(privateStoreRoot()),
    privateStorePathPrinted: false,
    headCommitExists: hasHeadCommit(cwd),
    cleanWorkspaceStrategy: cleanWorkspaceStrategy(cwd),
    lastValidationSummary: existsSync(validationSummaryPath(cwd)) ? JSON.parse(readFileSync(validationSummaryPath(cwd), "utf8")) : null
  };
}

function verifyPackageContents(packOutput: string): { passed: boolean; forbidden: string[]; files: string[] } {
  const parsed = JSON.parse(packOutput) as Array<{ files: Array<{ path: string }> }>;
  const files = parsed.flatMap((item) => item.files.map((file) => file.path));
  const forbiddenPatterns = [
    /^\.agent\//,
    /hidden-tests/,
    /\.hidden-tests/,
    /\.validator-private/,
    /\.agent-private/,
    /\.codex-private/,
    /\.private\.json$/,
    /\.hidden\.json$/,
    /auth\.json/,
    /config\.toml\.bak/
  ];
  const forbidden = files.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));
  return { passed: forbidden.length === 0, forbidden, files };
}

function verifySelf(cwd: string): Record<string, unknown> {
  const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd, encoding: "utf8", timeout: 120_000 });
  const packCheck = pack.status === 0 ? verifyPackageContents(pack.stdout) : { passed: false, forbidden: ["npm pack failed"], files: [] };
  const hookInputs = [
    ["user-prompt-submit", userPromptSubmit({ prompt: "debug latest framework issue" }, sourceRoot, { config: { autoRouteOnUserPromptSubmit: false } })],
    ["pre-tool-use-private-path-guard", preToolUsePrivatePathGuard({ command: "ls src" })],
    ["stop-validation-gate", stopValidationGate({ cwd, hardflowRequired: false })],
    ["subagent-start-context", subagentStartContext()],
    ["subagent-stop-loop-gate", subagentStopLoopGate({})]
  ];
  const hookJsonValid = hookInputs.every(([, output]) => {
    JSON.parse(JSON.stringify(output));
    return true;
  });
  const forbiddenUserPath = ["", "Users", "yang"].join("/");
  const grep = spawnSync("rg", [forbiddenUserPath, "src", "bin"], { cwd, encoding: "utf8" });
  const pathStatus = cliPathStatus(sourceRoot);
  const globalWrapperFresh = pathStatus.globalWrapperTarget === null || pathStatus.wrapperPointsToCurrentSourceRoot;
  return {
    packDryRunPassed: pack.status === 0,
    packCheck,
    hookJsonValid,
    globalWrapperFresh,
    globalWrapperPath: pathStatus.globalWrapperPath,
    globalWrapperTarget: pathStatus.globalWrapperTarget,
    wrapperPointsToCurrentSourceRoot: pathStatus.wrapperPointsToCurrentSourceRoot,
    wrapperWarning: globalWrapperFresh ? undefined : "global codex-hardflow wrapper is stale; run node dist/cli.js install-global",
    noRuntimeUserPathInSource: grep.status === 1,
    noRuntimeUserPathMatches: grep.stdout.trim().split("\n").filter(Boolean),
    passed: pack.status === 0 && packCheck.passed && hookJsonValid && grep.status === 1 && globalWrapperFresh
  };
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const cwd = process.cwd();

  try {
    switch (command) {
      case "status":
        printJson(status(cwd));
        return;
      case "route": {
        const parsed = parseFlagArgs(args);
        const task = parsed.rest.join(" ");
        if (!task) throw new Error("Usage: codex-hardflow route [--owner parent|subagent] \"task...\"");
        const runId = stringFlag(parsed.flags, "run-id");
        const owner = routerOwnerFlag(stringFlag(parsed.flags, "owner"));
        const parentRunId = stringFlag(parsed.flags, "parent-run-id");
        const subagentName = stringFlag(parsed.flags, "subagent-name");
        const bucket = stringFlag(parsed.flags, "bucket");
        const writeTrace = Object.hasOwn(parsed.flags, "write-trace") ? booleanFlag(parsed.flags, "write-trace") : Boolean(runId) || Boolean(parentRunId);
        const result = await runLlmRouter(
          {
            rawUserPrompt: stringFlag(parsed.flags, "raw-user-prompt") ?? task,
            normalizedTask: task,
            currentRunId: runId,
            triggerSource: "cli_command",
            programmaticTrigger: true
          },
          {
            cwd,
            timeoutMs: numberFlag(parsed.flags, "timeout"),
            turnId: stringFlag(parsed.flags, "turn-id"),
            writeTrace,
            owner,
            parentRunId,
            subagentName,
            bucket,
            triggerSource: "cli_command",
            programmaticTrigger: true
          }
        );
        if (result.trace.runId) {
          appendHookEvent(cwd, {
            eventName: "CLI",
            command: "route",
            runId: result.trace.runId,
            turnId: result.trace.turnId,
            promptHash: result.trace.promptHash,
            triggerSource: "cli_command",
            programmaticTrigger: true
          });
        }
        printJson(result.trace);
        return;
      }
      case "research": {
        const researchSubcommand = args[0];
        if (researchSubcommand === "request") {
          const requestCommand = args[1];
          const parsed = parseFlagArgs(args.slice(2));
          if (requestCommand === "create") {
            const input = await readOptionalStdinJson();
            const requiredBuckets = parseCsv(stringFlag(parsed.flags, "required-buckets"), stringArrayField(input, ["requiredBuckets", "required_buckets"]) ?? []);
            printJson(
              createResearchRequest(cwd, {
                runId: pickString(parsed.flags, input, ["run-id"], ["runId", "run_id"], true) ?? "",
                requestId: pickString(parsed.flags, input, ["request-id"], ["requestId", "request_id"]),
                requestedBy: requestedByFlag(pickString(parsed.flags, input, ["requested-by"], ["requestedBy", "requested_by"])),
                stage: requestStageFlag(pickString(parsed.flags, input, ["stage"], ["stage"])),
                reason: pickString(parsed.flags, input, ["reason"], ["reason"], true) ?? "",
                question: pickString(parsed.flags, input, ["question"], ["question"], true) ?? "",
                requiredBuckets,
                urgency: requestUrgencyFlag(pickString(parsed.flags, input, ["urgency"], ["urgency"])),
                contextRefs: pickStringArray(parsed.flags, input, "context-ref", ["contextRefs", "context_refs"]),
                relatedFiles: pickStringArray(parsed.flags, input, "related-file", ["relatedFiles", "related_files"])
              })
            );
            return;
          }
          if (requestCommand === "list") {
            printJson({ requests: listResearchRequests(cwd, stringFlag(parsed.flags, "run-id")) });
            return;
          }
          if (requestCommand === "run") {
            if (!booleanFlag(parsed.flags, "strict-programmatic")) {
              throw new Error("codex-hardflow research request run requires --strict-programmatic.");
            }
            printJson(
              await runResearchRequest(cwd, stringFlag(parsed.flags, "run-id", true) ?? "", stringFlag(parsed.flags, "request-id", true) ?? "", {
                sourceRoot,
                strictProgrammatic: true,
                coverageMode: "exhaustive",
                parallelPolicy: "all_required",
                maxConcurrentBuckets: numberFlag(parsed.flags, "max-concurrent"),
                workerLeaseMs: numberFlag(parsed.flags, "worker-lease"),
                softTimeoutMs: numberFlag(parsed.flags, "soft-timeout"),
                hardTimeoutMs: numberFlag(parsed.flags, "hard-timeout"),
                globalBudgetMs: numberFlag(parsed.flags, "global-budget"),
                heartbeatIntervalMs: numberFlag(parsed.flags, "heartbeat-interval"),
                maxNoProgressHeartbeats: numberFlag(parsed.flags, "max-no-progress-heartbeats"),
                maxSourcesPerWorker: numberFlag(parsed.flags, "max-sources-per-worker")
              })
            );
            return;
          }
          if (requestCommand === "resolve") {
            printJson(
              resolveResearchRequest(cwd, {
                runId: stringFlag(parsed.flags, "run-id", true) ?? "",
                requestId: stringFlag(parsed.flags, "request-id", true) ?? "",
                status: requestResolveStatusFlag(stringFlag(parsed.flags, "status")),
                linkedResearchRunId: stringFlag(parsed.flags, "linked-research-run-id"),
                failureReason: stringFlag(parsed.flags, "failure-reason")
              })
            );
            return;
          }
          throw new Error("Usage: codex-hardflow research request <create|list|run|resolve>");
        }
        if (researchSubcommand === "resume") {
          const parsed = parseFlagArgs(args.slice(1));
          printJson(
            await resumeResearchRun(cwd, stringFlag(parsed.flags, "run-id", true) ?? "", {
              maxConcurrentBuckets: numberFlag(parsed.flags, "max-concurrent"),
              workerLeaseMs: numberFlag(parsed.flags, "worker-lease"),
              softTimeoutMs: numberFlag(parsed.flags, "soft-timeout"),
              hardTimeoutMs: numberFlag(parsed.flags, "hard-timeout"),
              globalBudgetMs: numberFlag(parsed.flags, "global-budget"),
              heartbeatIntervalMs: numberFlag(parsed.flags, "heartbeat-interval"),
              maxNoProgressHeartbeats: numberFlag(parsed.flags, "max-no-progress-heartbeats"),
              maxSourcesPerWorker: numberFlag(parsed.flags, "max-sources-per-worker")
            })
          );
          return;
        }
        if (researchSubcommand === "workers") {
          const parsed = parseFlagArgs(args.slice(1));
          printJson({
            runId: stringFlag(parsed.flags, "run-id", true),
            workers: listResearchWorkers(cwd, stringFlag(parsed.flags, "run-id", true) ?? "")
          });
          return;
        }
        if (researchSubcommand === "cancel") {
          const parsed = parseFlagArgs(args.slice(1));
          printJson(cancelResearchWorker(cwd, stringFlag(parsed.flags, "run-id", true) ?? "", stringFlag(parsed.flags, "bucket", true) ?? ""));
          return;
        }
        const parsed = parseFlagArgs(args);
        const task = parsed.rest.join(" ");
        if (!task) throw new Error("Usage: codex-hardflow research \"task...\"");
        const requestedRunner = stringFlag(parsed.flags, "runner");
        if (!validRunnerMode(requestedRunner)) {
          if (requestedRunner) throw new Error(`Invalid --runner: ${requestedRunner}`);
        }
        if (requestedRunner === "mixed") throw new Error("--runner mixed is a report state; use app_handoff, manual_fallback, or sdk_threads.");
        const strictProgrammatic = booleanFlag(parsed.flags, "strict-programmatic");
        const executeSdkResearch = booleanFlag(parsed.flags, "execute-sdk-research") || strictProgrammatic;
        if (executeSdkResearch && requestedRunner && requestedRunner !== "sdk_threads" && requestedRunner !== "strict_programmatic") {
          throw new Error("--execute-sdk-research conflicts with non-sdk --runner.");
        }
        const runnerMode: ResearchRunnerMode | undefined = strictProgrammatic
          ? "strict_programmatic"
          : executeSdkResearch
            ? "sdk_threads"
          : validRunnerMode(requestedRunner)
            ? requestedRunner
            : undefined;
        printJson(
          await runResearch(task, cwd, {
            sourceRoot,
            rawUserPrompt: stringFlag(parsed.flags, "raw-user-prompt") ?? task,
            normalizedTask: task,
            runId: stringFlag(parsed.flags, "run-id"),
            runnerMode,
            executeSdkResearch,
            strictProgrammatic,
            coverageMode: coverageModeFlag(stringFlag(parsed.flags, "coverage-mode")),
            parallelPolicy: parallelPolicyFlag(stringFlag(parsed.flags, "parallel-policy")),
            runRouter: booleanFlag(parsed.flags, "run-router"),
            maxConcurrentBuckets: numberFlag(parsed.flags, "max-concurrent"),
            workerLeaseMs: numberFlag(parsed.flags, "worker-lease"),
            softTimeoutMs: numberFlag(parsed.flags, "soft-timeout"),
            hardTimeoutMs: numberFlag(parsed.flags, "hard-timeout"),
            perBucketTimeoutMs: numberFlag(parsed.flags, "per-bucket-timeout"),
            globalBudgetMs: numberFlag(parsed.flags, "global-budget"),
            heartbeatIntervalMs: numberFlag(parsed.flags, "heartbeat-interval"),
            maxNoProgressHeartbeats: numberFlag(parsed.flags, "max-no-progress-heartbeats"),
            maxSourcesPerWorker: numberFlag(parsed.flags, "max-sources-per-worker"),
            progress: runnerMode === "sdk_threads" || runnerMode === "strict_programmatic" ? sdkProgress : undefined
          })
        );
        return;
      }
      case "report": {
        const subcommand = args[0];
        const parsed = parseFlagArgs(args.slice(1));
        if (subcommand === "add-source") {
          const input = await readOptionalStdinJson();
          const confidence = pickString(parsed.flags, input, ["confidence"], ["confidence"]) as Confidence | undefined;
          if (confidence && confidence !== "high" && confidence !== "medium" && confidence !== "low") {
            throw new Error("--confidence must be high, medium, or low.");
          }
          printJson(
            addManualSourceToReport(cwd, {
              bucket: pickString(parsed.flags, input, ["bucket"], ["bucket"], true) ?? "",
              runId: pickString(parsed.flags, input, ["run-id"], ["runId", "run_id"]),
              title: pickString(parsed.flags, input, ["title"], ["title"], true) ?? "",
              source_type: pickString(parsed.flags, input, ["source-type"], ["source_type", "sourceType"]),
              url_or_ref: pickString(parsed.flags, input, ["url-or-ref", "url"], ["url_or_ref", "urlOrRef", "url"], true) ?? "",
              date_or_version: pickString(parsed.flags, input, ["date-or-version", "date"], ["date_or_version", "dateOrVersion", "date"]),
              claim: pickString(parsed.flags, input, ["claim"], ["claim"], true) ?? "",
              confidence,
              notes: pickString(parsed.flags, input, ["notes"], ["notes"]),
              finding: pickString(parsed.flags, input, ["finding"], ["finding"]),
              citation: pickString(parsed.flags, input, ["citation"], ["citation"])
            })
          );
          return;
        }
        if (subcommand === "finalize-manual") {
          const input = await readOptionalStdinJson();
          printJson(
            finalizeManualReport(cwd, {
              runId: pickString(parsed.flags, input, ["run-id"], ["runId", "run_id"]),
              usefulFindings: pickStringArray(parsed.flags, input, "useful-finding", ["usefulFindings", "useful_findings"]),
              conflictingFindings: pickStringArray(parsed.flags, input, "conflicting-finding", ["conflictingFindings", "conflicting_findings"]),
              sourceGaps: pickStringArray(parsed.flags, input, "source-gap", ["sourceGaps", "source_gaps"]),
              citationsOrRefs: pickStringArray(parsed.flags, input, "citation", ["citationsOrRefs", "citations_or_refs"]),
              confidenceSummary: pickString(parsed.flags, input, ["confidence-summary"], ["confidenceSummary", "confidence_summary"])
            })
          );
          return;
        }
        if (subcommand === "add-subagent-report") {
          const input = await readOptionalStdinJson();
          const status = pickString(parsed.flags, input, ["status"], ["status"], true);
          if (!validSubagentStatus(status)) throw new Error("--status must be completed, timeout, failed, or searched_but_no_signal.");
          printJson(
            addSubagentReport(cwd, {
              parentRunId: pickString(parsed.flags, input, ["run-id"], ["parentRunId", "parent_run_id"]),
              runId: pickString(parsed.flags, input, ["subagent-run-id"], ["subagentRunId", "subagent_run_id", "runId", "run_id"]),
              agent: pickString(parsed.flags, input, ["agent"], ["agent"], true) ?? "",
              bucket: pickString(parsed.flags, input, ["bucket"], ["bucket"], true) ?? "",
              status,
              sources_found: sourceArrayField(input, ["sources_found", "sourcesFound"]),
              searched_but_no_signal: booleanFlag(parsed.flags, "searched-but-no-signal") || input.searched_but_no_signal === true || input.searchedButNoSignal === true,
              queries_run: pickStringArray(parsed.flags, input, "query", ["queries_run", "queriesRun"]),
              failure_reason: pickString(parsed.flags, input, ["failure-reason"], ["failure_reason", "failureReason"]),
              startedAt: pickString(parsed.flags, input, ["started-at"], ["startedAt", "started_at"]),
              endedAt: pickString(parsed.flags, input, ["ended-at"], ["endedAt", "ended_at"])
            })
          );
          return;
        }
        if (subcommand === "merge-subagents") {
          printJson(mergeSubagentReports(cwd, stringFlag(parsed.flags, "run-id")));
          return;
        }
        if (subcommand === "status") {
          printJson(researchReportSummary(cwd, stringFlag(parsed.flags, "run-id")));
          return;
        }
        if (subcommand === "show") {
          printJson(loadResearchReport(cwd, stringFlag(parsed.flags, "run-id")));
          return;
        }
        if (subcommand === "assert-evidence") {
          const input = await readOptionalStdinJson();
          const finalAnswerSources = pickStringArray(parsed.flags, input, "final-answer-source", ["finalAnswerSources", "final_answer_sources"]);
          const result = assertResearchReportEvidence(loadResearchReport(cwd, stringFlag(parsed.flags, "run-id")), { finalAnswerSources });
          printJson(result);
          if (!result.passed) process.exitCode = 1;
          return;
        }
        throw new Error("Usage: codex-hardflow report <add-source|finalize-manual|add-subagent-report|merge-subagents|status|show|assert-evidence>");
      }
      case "hooks": {
        const subcommand = args[0];
        const parsed = parseFlagArgs(args.slice(1));
        if (subcommand === "status") {
          printJson(hookStatus(cwd, stringFlag(parsed.flags, "run-id")));
          return;
        }
        if (subcommand === "assert-active") {
          const runId = stringFlag(parsed.flags, "run-id", true) ?? "";
          const result = assertHookActive(cwd, runId);
          printJson(result);
          if (!result.passed) process.exitCode = 1;
          return;
        }
        throw new Error("Usage: codex-hardflow hooks <status|assert-active> [--run-id <runId>]");
      }
      case "eval": {
        const subcommand = args[0];
        const parsed = parseFlagArgs(args.slice(1));
        if (subcommand === "coverage") {
          printJson(
            evaluateCoverage(cwd, {
              runId: stringFlag(parsed.flags, "run-id"),
              latestEvidenceRun: booleanFlag(parsed.flags, "latest-evidence-run"),
              includeTestRuns: booleanFlag(parsed.flags, "include-test-runs"),
              baselineRunId: stringFlag(parsed.flags, "baseline-run-id")
            })
          );
          return;
        }
        throw new Error("Usage: codex-hardflow eval coverage [--run-id <runId>|--latest-evidence-run] [--include-test-runs] [--baseline-run-id <runId>]");
      }
      case "diagnostics": {
        const subcommand = args[0];
        if (!validDiagnosticsCommand(subcommand)) {
          throw new Error("Usage: codex-hardflow diagnostics <sdk-concurrency|sdk-prompt-width|sdk-bucket-difficulty|sdk-timeout-sweep|sdk-checkpoint-resume>");
        }
        const parsed = parseFlagArgs(args.slice(1));
        printJson(
          await runDiagnostics({
            command: subcommand,
            cwd,
            task: stringFlag(parsed.flags, "task"),
            buckets: parseCsv(stringFlag(parsed.flags, "buckets"), []),
            concurrencyLevels: parseNumberCsv(stringFlag(parsed.flags, "concurrency-levels"), []),
            repeats: numberFlag(parsed.flags, "repeats"),
            maxSourcesPerWorker: numberFlag(parsed.flags, "max-sources-per-worker"),
            heartbeatIntervalMs: numberFlag(parsed.flags, "heartbeat-interval-ms"),
            workerLeaseMs: numberFlag(parsed.flags, "worker-lease-ms"),
            softTimeoutMs: numberFlag(parsed.flags, "soft-timeout-ms"),
            hardTimeoutMs: numberFlag(parsed.flags, "hard-timeout-ms"),
            globalBudgetMs: numberFlag(parsed.flags, "global-budget-ms"),
            output: stringFlag(parsed.flags, "output"),
            workdirRoot: stringFlag(parsed.flags, "workdir-root"),
            dryRun: Object.hasOwn(parsed.flags, "dry-run") ? booleanFlag(parsed.flags, "dry-run") : undefined,
            execute: booleanFlag(parsed.flags, "execute"),
            realSdk: booleanFlag(parsed.flags, "real-sdk"),
            randomize: booleanFlag(parsed.flags, "no-randomize") ? false : Object.hasOwn(parsed.flags, "randomize") ? booleanFlag(parsed.flags, "randomize") : undefined,
            materializeDryRun: booleanFlag(parsed.flags, "materialize-dry-run"),
            runIdPrefix: stringFlag(parsed.flags, "run-id-prefix"),
            timeoutLevels: parseNumberCsv(stringFlag(parsed.flags, "timeout-levels"), [])
          })
        );
        return;
      }
      case "implement": {
        const task = args.join(" ");
        if (!task) throw new Error("Usage: codex-hardflow implement \"task...\"");
        await runResearch(task, cwd, { sourceRoot });
        requireExecutorManifest(cwd);
        printJson(validate(cwd));
        return;
      }
      case "validate":
        printJson(validate(cwd));
        return;
      case "probe-logprobs": {
        const result = await runLogprobsProbe(cwd);
        printJson(result.summary);
        return;
      }
      case "repair-loop":
        printJson(stopValidationGate({ cwd, hardflowRequired: true }));
        return;
      case "parallel": {
        const file = args.find((arg) => !arg.startsWith("--"));
        if (!file) throw new Error("Usage: codex-hardflow parallel modules.yaml [--execute]");
        printJson(planParallelModules(resolve(cwd, file), cwd, args.includes("--execute")));
        return;
      }
      case "install-global":
        printJson(installGlobal(sourceRoot));
        return;
      case "verify":
      case "verify:self":
        {
          const result = verifySelf(cwd);
          printJson(result);
          if (!result.passed) process.exitCode = 1;
        }
        return;
      case "hook": {
        const hook = args[0];
        const input = await readStdinJson();
        if (hook === "user-prompt-submit") printJson(userPromptSubmit(input, sourceRoot));
        else if (hook === "pre-tool-use-private-path-guard") printJson(preToolUsePrivatePathGuard(input));
        else if (hook === "stop-validation-gate") printJson(stopValidationGate(input));
        else if (hook === "subagent-start-context") printJson(subagentStartContext());
        else if (hook === "subagent-stop-loop-gate") printJson(subagentStopLoopGate(input));
        else throw new Error(`Unknown hook: ${hook ?? ""}`);
        return;
      }
      case "uninstall": {
        const execute = args.includes("--execute");
        const dryRun = args.includes("--dry-run") || !execute;
        printJson({
          dryRun,
          wouldRemove: [
            "codex-hardflow section in ~/.codex/AGENTS.md",
            "~/.codex/agents/*hardflow agent files",
            "~/.agents/skills/codex-hardflow",
            "codex-hardflow entries in ~/.codex/hooks.json",
            "~/.codex-hardflow/current.json"
          ],
          executed: false,
          reason: "Uninstall execute is intentionally not implemented in the first release; inspect and remove manually or extend with explicit confirmations."
        });
        return;
      }
      default:
        printJson({
          usage: [
            "codex-hardflow status",
            "codex-hardflow route [--run-id <runId>] [--owner parent|subagent] [--parent-run-id <runId>] [--subagent-name <agent>] [--bucket <bucket>] [--write-trace] \"task...\"",
            "codex-hardflow research --run-id <runId> \"task...\"",
            "codex-hardflow research --run-id <runId> --runner app_handoff \"task...\"",
            "codex-hardflow research --run-id <runId> --runner app_handoff --run-router \"task...\"",
            "codex-hardflow research --run-id <runId> --strict-programmatic [--coverage-mode exhaustive|balanced|fast] [--parallel-policy all_required|fixed|adaptive|wave] [--max-sources-per-worker <n>] \"task...\"",
            "codex-hardflow research request create --run-id <runId> --requested-by executor --stage execution --reason <reason> --question <question> [--required-buckets a,b]",
            "codex-hardflow research request list [--run-id <runId>]",
            "codex-hardflow research request run --strict-programmatic --run-id <runId> --request-id <requestId>",
            "codex-hardflow research request resolve --run-id <runId> --request-id <requestId> [--status resolved|failed|cancelled]",
            "codex-hardflow research resume --run-id <runId>",
            "codex-hardflow research workers --run-id <runId>",
            "codex-hardflow research cancel --run-id <runId> --bucket <bucket>",
            "research reuses an existing parent router_trace for the same runId by default; --run-router explicitly reruns router; --write-trace is boolean and does not consume task text.",
            "codex-hardflow report add-source [--run-id <runId>] --bucket <bucket> --title <title> --url <url> --claim <claim>",
            "codex-hardflow report finalize-manual [--run-id <runId>] [--useful-finding text]",
            "codex-hardflow report add-subagent-report [--run-id <parentRunId>] --agent <agent> --bucket <bucket> --status <status>",
            "codex-hardflow report merge-subagents [--run-id <runId>]",
            "codex-hardflow report status",
            "codex-hardflow report show",
            "codex-hardflow report assert-evidence",
            "codex-hardflow hooks status [--run-id <runId>]",
            "codex-hardflow hooks assert-active --run-id <runId>",
            "codex-hardflow eval coverage [--run-id <runId>|--latest-evidence-run] [--include-test-runs] [--baseline-run-id <runId>]",
            "codex-hardflow diagnostics sdk-concurrency [--dry-run|--execute --real-sdk] [--output <path>]",
            "codex-hardflow diagnostics sdk-prompt-width [--dry-run|--execute --real-sdk] [--output <path>]",
            "codex-hardflow diagnostics sdk-bucket-difficulty [--dry-run|--execute --real-sdk] [--output <path>]",
            "codex-hardflow diagnostics sdk-timeout-sweep [--dry-run|--execute --real-sdk] [--output <path>]",
            "codex-hardflow diagnostics sdk-checkpoint-resume [--dry-run] [--output <path>]",
            "codex-hardflow implement \"task...\"",
            "codex-hardflow validate",
            "codex-hardflow probe-logprobs",
            "codex-hardflow repair-loop",
            "codex-hardflow parallel modules.yaml [--execute]",
            "codex-hardflow install-global",
            "codex-hardflow verify",
            "codex-hardflow hook <hook-name>",
            "codex-hardflow uninstall --dry-run"
          ]
        });
    }
  } catch (error) {
    printJson({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

void main();
