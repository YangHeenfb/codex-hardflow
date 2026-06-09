import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cliPathStatus } from "./cliPaths.js";
import { codexRunnerStatus } from "./codexRunner.js";
import { installGlobal, SDK_VERSION } from "./config.js";
import { requireExecutorManifest } from "./executionOrchestrator.js";
import { cleanWorkspaceStrategy, hasHeadCommit } from "./gitUtils.js";
import { stopValidationGate } from "./hooks/stopValidationGate.js";
import { preToolUsePrivatePathGuard } from "./hooks/preToolUsePrivatePathGuard.js";
import { subagentStartContext } from "./hooks/subagentStartContext.js";
import { subagentStopLoopGate } from "./hooks/subagentStopLoopGate.js";
import { userPromptSubmit } from "./hooks/userPromptSubmit.js";
import { planParallelModules } from "./parallelOrchestrator.js";
import { codexHome, privateStoreRoot, skillPathStrategy, validationSummaryPath } from "./paths.js";
import { runLogprobsProbe } from "./probes/logprobsProbe.js";
import { addManualSourceToReport, finalizeManualReport, runResearch } from "./researchOrchestrator.js";
import { validate } from "./validationOrchestrator.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string; dependencies?: Record<string, string> };
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseFlagArgs(args: string[]): { flags: Record<string, string | true>; rest: string[] } {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else if (arg) {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function stringFlag(flags: Record<string, string | true>, key: string, required = false): string | undefined {
  const value = flags[key];
  if (typeof value === "string") return value;
  if (required) throw new Error(`Missing --${key}`);
  return undefined;
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

export function status(cwd: string, root = sourceRoot): Record<string, unknown> {
  const codexVersion = spawnSync("codex", ["--version"], { encoding: "utf8" });
  const strategy = skillPathStrategy();
  const pathStatus = cliPathStatus(root);
  return {
    packageVersion: packageJson.version,
    codexCli: codexVersion.status === 0 ? codexVersion.stdout.trim() : "unavailable",
    absoluteCliAvailable: pathStatus.absoluteCliAvailable,
    wrapperAvailable: pathStatus.wrapperAvailable,
    wrapperConflict: pathStatus.wrapperConflict,
    shellPathAvailable: pathStatus.shellPathAvailable,
    appPathAvailable: pathStatus.appPathAvailable,
    absoluteCommand: pathStatus.absoluteCommand,
    wrapperPath: pathStatus.wrapperPath,
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
    ["user-prompt-submit", userPromptSubmit({ prompt: "debug latest framework issue" }, sourceRoot)],
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
  return {
    packDryRunPassed: pack.status === 0,
    packCheck,
    hookJsonValid,
    noRuntimeUserPathInSource: grep.status === 1,
    noRuntimeUserPathMatches: grep.stdout.trim().split("\n").filter(Boolean),
    passed: pack.status === 0 && packCheck.passed && hookJsonValid && grep.status === 1
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
      case "research": {
        const parsed = parseFlagArgs(args);
        const task = parsed.rest.join(" ");
        if (!task) throw new Error("Usage: codex-hardflow research \"task...\"");
        printJson(await runResearch(task, cwd, { sourceRoot, rawUserPrompt: stringFlag(parsed.flags, "raw-user-prompt") ?? task, normalizedTask: task }));
        return;
      }
      case "report": {
        const subcommand = args[0];
        const parsed = parseFlagArgs(args.slice(1));
        if (subcommand === "add-source") {
          printJson(
            addManualSourceToReport(cwd, {
              bucket: stringFlag(parsed.flags, "bucket", true) ?? "",
              title: stringFlag(parsed.flags, "title", true) ?? "",
              source_type: stringFlag(parsed.flags, "source-type"),
              url_or_ref: stringFlag(parsed.flags, "url", true) ?? "",
              date_or_version: stringFlag(parsed.flags, "date"),
              claim: stringFlag(parsed.flags, "claim", true) ?? "",
              confidence: stringFlag(parsed.flags, "confidence") as "high" | "medium" | "low" | undefined,
              notes: stringFlag(parsed.flags, "notes"),
              finding: stringFlag(parsed.flags, "finding"),
              citation: stringFlag(parsed.flags, "citation")
            })
          );
          return;
        }
        if (subcommand === "finalize-manual") {
          printJson(
            finalizeManualReport(cwd, {
              usefulFindings: stringFlag(parsed.flags, "useful-finding") ? [stringFlag(parsed.flags, "useful-finding") ?? ""] : undefined,
              conflictingFindings: stringFlag(parsed.flags, "conflicting-finding") ? [stringFlag(parsed.flags, "conflicting-finding") ?? ""] : undefined,
              sourceGaps: stringFlag(parsed.flags, "source-gap") ? [stringFlag(parsed.flags, "source-gap") ?? ""] : undefined,
              citationsOrRefs: stringFlag(parsed.flags, "citation") ? [stringFlag(parsed.flags, "citation") ?? ""] : undefined,
              confidenceSummary: stringFlag(parsed.flags, "confidence-summary")
            })
          );
          return;
        }
        throw new Error("Usage: codex-hardflow report add-source --bucket <bucket> --title <title> --url <url> --claim <claim>");
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
            "codex-hardflow research \"task...\"",
            "codex-hardflow report add-source --bucket <bucket> --title <title> --url <url> --claim <claim>",
            "codex-hardflow report finalize-manual [--useful-finding text]",
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
