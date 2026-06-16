import { runIsolatedCodexPrompt } from "../codexRunner.js";
import { routerFailedOutput } from "./routerFallback.js";
import { normalizeRouterOutput } from "./routerNormalize.js";
import { buildRouterPrompt } from "./routerPrompt.js";
import { parseRouterOutput, type RouterInput, type RouterMode, type RouterOutput, type RouterTrace, type RouterTraceOwner } from "./routerSchema.js";
import { buildRouterTrace, writeRouterTrace } from "./routerTrace.js";
import type { TriggerSource } from "../schemas.js";

const DEFAULT_ROUTER_TIMEOUT_MS = 45_000;

export interface LlmRouterOptions {
  cwd: string;
  timeoutMs?: number;
  promptRunner?: (prompt: string, cwd: string) => Promise<string>;
  repairPromptRunner?: (prompt: string, cwd: string) => Promise<string>;
  writeTrace?: boolean;
  turnId?: string;
  owner?: RouterTraceOwner;
  parentRunId?: string;
  subagentName?: string;
  bucket?: string;
  triggerSource?: TriggerSource;
  programmaticTrigger?: boolean;
}

class RouterTimeoutError extends Error {}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Router output did not contain a JSON object.");
  return JSON.parse(raw.slice(start, end + 1));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function withDiagnostics(output: RouterOutput, diagnostics: Record<string, unknown>): RouterOutput {
  return {
    ...output,
    diagnostics: {
      ...(output.diagnostics ?? {}),
      ...diagnostics
    }
  };
}

function parseWithNormalization(raw: unknown): { output?: RouterOutput; normalizationWarnings?: string[]; parseError?: unknown; normalizedError?: unknown; normalizedCandidate?: unknown } {
  try {
    return { output: parseRouterOutput(raw) };
  } catch (parseError) {
    const normalization = normalizeRouterOutput(raw);
    try {
      const output = parseRouterOutput(normalization.normalized);
      return {
        output: withDiagnostics(output, {
          normalized: true,
          normalizationWarnings: normalization.warnings
        }),
        normalizationWarnings: normalization.warnings
      };
    } catch (normalizedError) {
      return {
        parseError,
        normalizedError,
        normalizedCandidate: normalization.normalized,
        normalizationWarnings: normalization.warnings
      };
    }
  }
}

function buildRouterRepairPrompt(rawOutput: unknown, parseError: unknown, normalizedCandidate: unknown, normalizedError: unknown, warnings: string[]): string {
  return [
    "Repair this codex-hardflow router JSON shape only.",
    "Do not change the route intent, workflow intent, source intent, bypass intent, or validation intent.",
    "Return one JSON object only. Do not add prose.",
    "",
    "Expected schema summary:",
    "- sourceBuckets: array of { bucket, status, reason }.",
    "- requiredAgents: array of { name, required: true, reason }.",
    "- bypass: { requested: boolean, reason: string }.",
    "- risks: array of allowed risk strings.",
    "- reasons: array of strings.",
    "- required booleans: requiresSourceMatrix, requiresExecutorManifest, requiresValidation, requiresFinalHoldout, requiresParallelIsolation.",
    "",
    "Original router output:",
    JSON.stringify(rawOutput, null, 2),
    "",
    "Initial validation error:",
    describeError(parseError),
    "",
    "Normalized candidate:",
    JSON.stringify(normalizedCandidate, null, 2),
    "",
    "Normalized validation error:",
    describeError(normalizedError),
    "",
    "Normalization warnings:",
    JSON.stringify(warnings, null, 2)
  ].join("\n");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new RouterTimeoutError(`router timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runLlmRouter(input: RouterInput, options: LlmRouterOptions): Promise<{ output: RouterOutput; trace: RouterTrace }> {
  const prompt = buildRouterPrompt(input);
  const runner =
    options.promptRunner ??
    ((routerPrompt: string, cwd: string) =>
      runIsolatedCodexPrompt(routerPrompt, cwd, true, {
        purpose: "router",
        parentRunId: input.currentRunId ?? "router"
      }));
  const repairRunner = options.repairPromptRunner ?? runner;
  let output: RouterOutput;
  let routerMode: RouterMode = "llm";
  let fallbackReason: string | undefined;

  try {
    const raw = await withTimeout(runner(prompt, options.cwd), options.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS);
    const rawJson = extractJsonObject(raw);
    const parsed = parseWithNormalization(rawJson);
    if (parsed.output) {
      output = parsed.output;
    } else {
      const repairPrompt = buildRouterRepairPrompt(rawJson, parsed.parseError, parsed.normalizedCandidate, parsed.normalizedError, parsed.normalizationWarnings ?? []);
      const repairRaw = await withTimeout(repairRunner(repairPrompt, options.cwd), options.timeoutMs ?? DEFAULT_ROUTER_TIMEOUT_MS);
      try {
        output = withDiagnostics(parseRouterOutput(extractJsonObject(repairRaw)), {
          normalized: true,
          repairRetryUsed: true,
          normalizationWarnings: parsed.normalizationWarnings ?? []
        });
      } catch (repairError) {
        throw new Error(`Router output failed schema after normalization and repair retry: ${describeError(repairError)}`);
      }
    }
    if (output.route === "bypass" || output.bypass.requested) routerMode = "semantic_bypass";
  } catch (error) {
    fallbackReason = describeError(error);
    output = routerFailedOutput("Router unavailable or invalid; no keyword fallback used.");
    routerMode = "router_failed";
  }

  const trace = buildRouterTrace(input, output, routerMode, fallbackReason, options.turnId, {
    owner: options.owner ?? "parent",
    parentRunId: options.parentRunId,
    subagentName: options.subagentName,
    bucket: options.bucket,
    triggerSource: options.triggerSource,
    programmaticTrigger: options.programmaticTrigger
  });
  if (options.writeTrace !== false) writeRouterTrace(options.cwd, trace, true);
  return { output, trace };
}
