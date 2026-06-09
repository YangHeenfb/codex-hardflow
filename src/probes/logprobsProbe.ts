import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { Codex } from "@openai/codex-sdk";
import { SDK_VERSION } from "../config.js";
import { agentReportsDir } from "../paths.js";
import { sanitizeText } from "../sanitizer.js";

export const STATIC_LOGPROB_KEYWORDS = [
  "logprobs",
  "top_logprobs",
  "log_prob",
  "log_probability",
  "token_logprob",
  "probability",
  "topTokens",
  "tokenProbability"
] as const;

export const RUNTIME_LOGPROB_KEYWORDS = [...STATIC_LOGPROB_KEYWORDS, "logits", "tokens", "token"] as const;

const STRONG_LOGPROB_KEYWORDS = new Set<string>([...STATIC_LOGPROB_KEYWORDS, "logits"].map((keyword) => keyword.toLowerCase()));
const CODEX_PROMPT = "Return exactly one word: research";
const DEFAULT_CODEX_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const MAX_STATIC_FILE_BYTES = 2_000_000;
const MAX_SANITIZED_STRING_LENGTH = 20_000;
const MAX_SANITIZED_ARRAY_LENGTH = 5_000;

export interface StaticScanMatch {
  file: string;
  line: number;
  keyword: string;
  text: string;
}

export interface StaticScanResult {
  searched: boolean;
  packageRoot: string;
  matches: StaticScanMatch[];
  error?: string;
}

export interface LogprobLikeField {
  path: string;
  key: string;
  keyword: string;
  valueType: string;
  preview?: string;
}

export type RuntimeProbeConclusion = "available" | "not_found" | "error";

export interface CodexSdkRunProbe {
  ran: boolean;
  logprobLikeFieldsFound: LogprobLikeField[];
  resultKeys: string[];
  conclusion: RuntimeProbeConclusion;
  error?: string;
  reportPath?: string;
}

export interface CodexSdkStreamProbe {
  ran: boolean;
  eventTypes: string[];
  logprobLikeFieldsFound: LogprobLikeField[];
  conclusion: RuntimeProbeConclusion;
  error?: string;
  reportPath?: string;
}

export type OpenAiBaselineConclusion = "available" | "unsupported" | "error" | "not_tested";

export interface OpenAiApiBaselineProbe {
  ran: boolean;
  logprobsAvailable?: boolean;
  topLogprobsAvailable?: boolean;
  error?: string;
  reason?: string;
  model?: string;
  conclusion: OpenAiBaselineConclusion;
  reportPath?: string;
}

export interface LogprobsProbeSummary {
  codexSdkLogprobsAvailable: boolean | "unknown";
  codexSdkRunLogprobsAvailable: boolean | "unknown";
  codexSdkStreamLogprobsAvailable: boolean | "unknown";
  openaiApiBaselineLogprobsAvailable: boolean | "not_tested" | "unknown";
  recommendedRouterConfidenceStrategy: "codex_logprobs" | "openai_api_route_head" | "stability_only";
  notes: string[];
}

export interface LogprobsProbeResult {
  staticScan: StaticScanResult;
  codexSdkRun: CodexSdkRunProbe;
  codexSdkStream: CodexSdkStreamProbe;
  openaiApiBaseline: OpenAiApiBaselineProbe;
  summary: LogprobsProbeSummary;
}

export interface LogprobsProbeOptions {
  packageRoot?: string;
  reportsDir?: string;
  runCodexRuntime?: boolean;
  runOpenAiBaseline?: boolean;
  codexRunTimeoutMs?: number;
  codexStreamTimeoutMs?: number;
  openAiTimeoutMs?: number;
  openAiModel?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const routeOutputSchema = {
  type: "object",
  properties: {
    route: {
      type: "string",
      enum: ["research", "implementation", "direct_answer"]
    }
  },
  required: ["route"],
  additionalProperties: false
} as const;

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function displayPath(cwd: string, file: string): string {
  const rel = relative(cwd, file);
  return rel.startsWith("..") || rel === "" ? file : rel;
}

function keywordMatches(rawKey: string, rawKeyword: string): boolean {
  const key = rawKey.toLowerCase();
  const keyword = rawKeyword.toLowerCase();
  return key.includes(keyword) || key.replace(/[_-]/g, "").includes(keyword.replace(/[_-]/g, ""));
}

function matchingKeyword(key: string, keywords: readonly string[]): string | null {
  const ordered = [...keywords].sort((a, b) => b.length - a.length);
  return ordered.find((keyword) => keywordMatches(key, keyword)) ?? null;
}

function isTextLikeFile(file: string): boolean {
  if (file.endsWith(".d.ts")) return true;
  const ext = extname(file);
  return [".js", ".json", ".md", ".txt", ".map", ""].includes(ext);
}

function collectStaticFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (path: string): void => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
      return;
    }
    if (stat.isFile() && isTextLikeFile(path) && stat.size <= MAX_STATIC_FILE_BYTES) files.push(path);
  };
  visit(root);
  return files.sort();
}

export function scanCodexSdkPackage(cwd = process.cwd(), packageRoot = resolve(cwd, "node_modules", "@openai", "codex-sdk")): StaticScanResult {
  if (!existsSync(packageRoot)) {
    return {
      searched: false,
      packageRoot: displayPath(cwd, packageRoot),
      matches: [],
      error: "@openai/codex-sdk package root not found"
    };
  }

  const matches: StaticScanMatch[] = [];
  try {
    for (const file of collectStaticFiles(packageRoot)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        const keyword = matchingKeyword(line, STATIC_LOGPROB_KEYWORDS);
        if (!keyword) return;
        matches.push({
          file: displayPath(cwd, file),
          line: index + 1,
          keyword,
          text: sanitizeText(line.trim()).slice(0, 500)
        });
      });
    }
    return { searched: true, packageRoot: displayPath(cwd, packageRoot), matches };
  } catch (error) {
    return {
      searched: true,
      packageRoot: displayPath(cwd, packageRoot),
      matches,
      error: sanitizeText(error instanceof Error ? error.message : String(error))
    };
  }
}

function redactSecrets(text: string, env: NodeJS.ProcessEnv): string {
  let output = text;
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 8) continue;
    if (!/(?:api[_-]?key|secret|password|authorization|cookie|access[_-]?token|refresh[_-]?token|session[_-]?token)/i.test(key)) continue;
    output = output.split(value).join("[redacted-secret]");
  }
  return sanitizeText(output);
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function preview(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
  if (typeof value === "string") return redactSecrets(value, env).slice(0, 200);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object" && value) return `object(${Object.keys(value as Record<string, unknown>).slice(0, 8).join(",")})`;
  return undefined;
}

function childPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function findLogprobLikeFields(value: unknown, keywords: readonly string[] = RUNTIME_LOGPROB_KEYWORDS, env: NodeJS.ProcessEnv = process.env): LogprobLikeField[] {
  const matches: LogprobLikeField[] = [];
  const seen = new WeakSet<object>();
  let nodesVisited = 0;

  const visit = (node: unknown, path: string, depth: number): void => {
    if (depth > 30 || nodesVisited > 100_000) return;
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    nodesVisited += 1;

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const keyword = matchingKeyword(key, keywords);
      if (keyword) {
        matches.push({
          path: childPath(path, key),
          key,
          keyword,
          valueType: valueType(child),
          preview: preview(child, env)
        });
      }
      visit(child, childPath(path, key), depth + 1);
    }
  };

  visit(value, "$", 0);
  return matches;
}

function sanitizeForReport(value: unknown, env: NodeJS.ProcessEnv = process.env, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === "string") {
    const sanitized = redactSecrets(value, env);
    return sanitized.length > MAX_SANITIZED_STRING_LENGTH ? `${sanitized.slice(0, MAX_SANITIZED_STRING_LENGTH)}...[truncated]` : sanitized;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";

  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const item of value.slice(0, MAX_SANITIZED_ARRAY_LENGTH)) output.push(sanitizeForReport(item, env, seen));
    if (value.length > MAX_SANITIZED_ARRAY_LENGTH) output.push(`[${value.length - MAX_SANITIZED_ARRAY_LENGTH} array items truncated]`);
    return output;
  }

  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:api[_-]?key|secret|password|authorization|cookie|access[_-]?token|refresh[_-]?token|session[_-]?token)/i.test(key)) {
      output[key] = "[redacted-secret]";
    } else {
      output[key] = sanitizeForReport(child, env, seen);
    }
  }
  return output;
}

function hasStrongLogprobField(fields: LogprobLikeField[]): boolean {
  return fields.some((field) => STRONG_LOGPROB_KEYWORDS.has(field.keyword.toLowerCase()));
}

function availabilityFromConclusion(conclusion: RuntimeProbeConclusion): boolean | "unknown" {
  if (conclusion === "available") return true;
  if (conclusion === "not_found") return false;
  return "unknown";
}

function eventTypes(events: unknown[]): string[] {
  return Array.from(
    new Set(
      events.map((event) => {
        if (event && typeof event === "object" && "type" in event) return String((event as { type: unknown }).type);
        return "unknown";
      })
    )
  ).sort();
}

function errorMessage(error: unknown, env: NodeJS.ProcessEnv): string {
  return redactSecrets(error instanceof Error ? error.message : String(error), env);
}

async function runCodexSdkRunProbe(cwd: string, reportsDir: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<CodexSdkRunProbe> {
  const reportPath = join(reportsDir, "logprobs_probe_codex_run.json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const codex = new Codex();
    const thread = codex.startThread({
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      webSearchMode: "disabled",
      approvalPolicy: "never"
    });
    const result = await thread.run(CODEX_PROMPT, { outputSchema: routeOutputSchema, signal: controller.signal });
    const sanitizedResult = sanitizeForReport(result, env);
    const fields = findLogprobLikeFields(sanitizedResult, RUNTIME_LOGPROB_KEYWORDS, env);
    const probe: CodexSdkRunProbe = {
      ran: true,
      logprobLikeFieldsFound: fields,
      resultKeys: Object.keys((sanitizedResult as Record<string, unknown>) ?? {}),
      conclusion: hasStrongLogprobField(fields) ? "available" : "not_found",
      reportPath
    };
    writeJsonFile(reportPath, {
      sdkVersion: SDK_VERSION,
      prompt: CODEX_PROMPT,
      outputSchema: routeOutputSchema,
      threadId: thread.id,
      result: sanitizedResult,
      finalResponse: (sanitizedResult as { finalResponse?: unknown }).finalResponse,
      items: (sanitizedResult as { items?: unknown }).items,
      usage: (sanitizedResult as { usage?: unknown }).usage,
      logprobLikeFieldsFound: fields,
      resultKeys: probe.resultKeys,
      conclusion: probe.conclusion
    });
    return probe;
  } catch (error) {
    const message = errorMessage(error, env);
    const probe: CodexSdkRunProbe = { ran: true, logprobLikeFieldsFound: [], resultKeys: [], conclusion: "error", error: message, reportPath };
    writeJsonFile(reportPath, { sdkVersion: SDK_VERSION, prompt: CODEX_PROMPT, outputSchema: routeOutputSchema, error: message, conclusion: "error" });
    return probe;
  } finally {
    clearTimeout(timer);
  }
}

async function runCodexSdkStreamProbe(cwd: string, reportsDir: string, timeoutMs: number, env: NodeJS.ProcessEnv): Promise<CodexSdkStreamProbe> {
  const reportPath = join(reportsDir, "logprobs_probe_codex_stream.json");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const codex = new Codex();
    const thread = codex.startThread({
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      webSearchMode: "disabled",
      approvalPolicy: "never"
    });
    const streamed = await thread.runStreamed(CODEX_PROMPT, { outputSchema: routeOutputSchema, signal: controller.signal });
    const events: unknown[] = [];
    for await (const event of streamed.events) events.push(sanitizeForReport(event, env));
    const fields = findLogprobLikeFields(events, RUNTIME_LOGPROB_KEYWORDS, env);
    const types = eventTypes(events);
    const probe: CodexSdkStreamProbe = {
      ran: true,
      eventTypes: types,
      logprobLikeFieldsFound: fields,
      conclusion: hasStrongLogprobField(fields) ? "available" : "not_found",
      reportPath
    };
    writeJsonFile(reportPath, {
      sdkVersion: SDK_VERSION,
      prompt: CODEX_PROMPT,
      outputSchema: routeOutputSchema,
      threadId: thread.id,
      eventTypes: types,
      events,
      logprobLikeFieldsFound: fields,
      conclusion: probe.conclusion
    });
    return probe;
  } catch (error) {
    const message = errorMessage(error, env);
    const probe: CodexSdkStreamProbe = { ran: true, eventTypes: [], logprobLikeFieldsFound: [], conclusion: "error", error: message, reportPath };
    writeJsonFile(reportPath, { sdkVersion: SDK_VERSION, prompt: CODEX_PROMPT, outputSchema: routeOutputSchema, error: message, conclusion: "error" });
    return probe;
  } finally {
    clearTimeout(timer);
  }
}

function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function extractApiError(value: unknown): string {
  if (value && typeof value === "object") {
    const error = (value as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isUnsupportedLogprobsError(message: string): boolean {
  return /(?:logprobs|top_logprobs|unsupported|not supported|invalid_request_error)/i.test(message);
}

function inspectChatLogprobs(response: unknown): { logprobsAvailable: boolean; topLogprobsAvailable: boolean } {
  const choices = response && typeof response === "object" ? (response as { choices?: unknown }).choices : undefined;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const logprobs = firstChoice && typeof firstChoice === "object" ? (firstChoice as { logprobs?: unknown }).logprobs : undefined;
  const content = logprobs && typeof logprobs === "object" ? (logprobs as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) return { logprobsAvailable: false, topLogprobsAvailable: false };
  const logprobsAvailable = content.some((item) => item && typeof item === "object" && "logprob" in item);
  const topLogprobsAvailable = content.some((item) => {
    if (!item || typeof item !== "object") return false;
    const top = (item as { top_logprobs?: unknown }).top_logprobs;
    return Array.isArray(top) && top.length > 0;
  });
  return { logprobsAvailable, topLogprobsAvailable };
}

export async function runOpenAiApiBaselineProbe(cwd = process.cwd(), options: LogprobsProbeOptions = {}): Promise<OpenAiApiBaselineProbe> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return { ran: false, reason: "OPENAI_API_KEY not set", conclusion: "not_tested" };

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { ran: true, logprobsAvailable: false, topLogprobsAvailable: false, error: "global fetch is unavailable", conclusion: "error" };

  const reportsDir = options.reportsDir ?? agentReportsDir(cwd);
  const reportPath = join(reportsDir, "logprobs_probe_openai_baseline.json");
  const model = options.openAiModel ?? env.OPENAI_LOGPROBS_PROBE_MODEL ?? DEFAULT_OPENAI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.openAiTimeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS);
  const body = {
    model,
    messages: [
      {
        role: "system",
        content: "Classify the request into exactly one category: research, implementation, or direct_answer."
      },
      {
        role: "user",
        content: "Choose the category for this request: investigate whether a current SDK exposes token probabilities. Return only the category."
      }
    ],
    temperature: 0,
    max_tokens: 3,
    logprobs: true,
    top_logprobs: 3
  };

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: openAiHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await response
      .json()
      .catch(async () => response.text().catch(() => ""));
    const sanitizedPayload = sanitizeForReport(payload, env);
    writeJsonFile(reportPath, {
      model,
      request: { ...body, messages: "[short classification messages omitted]" },
      response: sanitizedPayload,
      status: response.status,
      ok: response.ok
    });

    if (!response.ok) {
      const message = redactSecrets(extractApiError(payload), env);
      return {
        ran: true,
        logprobsAvailable: false,
        topLogprobsAvailable: false,
        error: message,
        model,
        conclusion: isUnsupportedLogprobsError(message) ? "unsupported" : "error",
        reportPath
      };
    }

    const availability = inspectChatLogprobs(payload);
    return {
      ran: true,
      ...availability,
      model,
      conclusion: availability.logprobsAvailable ? "available" : "unsupported",
      reportPath
    };
  } catch (error) {
    const message = errorMessage(error, env);
    writeJsonFile(reportPath, { model, error: message, conclusion: "error" });
    return { ran: true, logprobsAvailable: false, topLogprobsAvailable: false, error: message, model, conclusion: "error", reportPath };
  } finally {
    clearTimeout(timer);
  }
}

export function buildLogprobsProbeSummary(input: {
  codexSdkRun: Pick<CodexSdkRunProbe, "conclusion" | "logprobLikeFieldsFound">;
  codexSdkStream: Pick<CodexSdkStreamProbe, "conclusion" | "logprobLikeFieldsFound">;
  openaiApiBaseline: OpenAiApiBaselineProbe;
  staticScan?: StaticScanResult;
}): LogprobsProbeSummary {
  const codexRunAvailable = availabilityFromConclusion(input.codexSdkRun.conclusion);
  const codexStreamAvailable = availabilityFromConclusion(input.codexSdkStream.conclusion);
  const codexSdkAvailable =
    codexRunAvailable === true || codexStreamAvailable === true
      ? true
      : codexRunAvailable === "unknown" || codexStreamAvailable === "unknown"
        ? "unknown"
        : false;
  const openAiAvailable = input.openaiApiBaseline.ran
    ? input.openaiApiBaseline.conclusion === "error"
      ? "unknown"
      : Boolean(input.openaiApiBaseline.logprobsAvailable)
    : "not_tested";

  const recommendedRouterConfidenceStrategy =
    codexSdkAvailable === true
      ? "codex_logprobs"
      : openAiAvailable === true
        ? "openai_api_route_head"
        : "stability_only";

  const notes: string[] = [];
  if (input.staticScan?.matches.length) notes.push(`Static SDK/package scan found ${input.staticScan.matches.length} logprob-like keyword match(es); this is only a clue, not runtime support.`);
  if (input.staticScan && input.staticScan.matches.length === 0) notes.push("Static SDK/package scan found no logprob-like keyword matches.");
  if (input.codexSdkRun.conclusion === "error") notes.push("Codex SDK thread.run() probe errored, so run availability is unknown.");
  if (input.codexSdkStream.conclusion === "error") notes.push("Codex SDK thread.runStreamed() probe errored, so stream availability is unknown.");
  if (!input.openaiApiBaseline.ran) notes.push(input.openaiApiBaseline.reason ?? "OpenAI API baseline was not tested.");
  if (input.openaiApiBaseline.conclusion === "unsupported") notes.push("OpenAI API baseline ran but did not expose requested Chat Completions logprobs.");
  if (input.openaiApiBaseline.conclusion === "error") notes.push("OpenAI API baseline errored; baseline availability is unknown.");

  return {
    codexSdkLogprobsAvailable: codexSdkAvailable,
    codexSdkRunLogprobsAvailable: codexRunAvailable,
    codexSdkStreamLogprobsAvailable: codexStreamAvailable,
    openaiApiBaselineLogprobsAvailable: openAiAvailable,
    recommendedRouterConfidenceStrategy,
    notes
  };
}

export async function runLogprobsProbe(cwd = process.cwd(), options: LogprobsProbeOptions = {}): Promise<LogprobsProbeResult> {
  const env = options.env ?? process.env;
  const reportsDir = options.reportsDir ?? agentReportsDir(cwd);
  const staticScan = scanCodexSdkPackage(cwd, options.packageRoot);
  writeJsonFile(join(reportsDir, "logprobs_probe_static_scan.json"), { staticScan });

  const codexSdkRun =
    options.runCodexRuntime === false
      ? { ran: false, logprobLikeFieldsFound: [], resultKeys: [], conclusion: "error" as const, error: "Codex runtime probe disabled" }
      : await runCodexSdkRunProbe(cwd, reportsDir, options.codexRunTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS, env);
  const codexSdkStream =
    options.runCodexRuntime === false
      ? { ran: false, eventTypes: [], logprobLikeFieldsFound: [], conclusion: "error" as const, error: "Codex runtime probe disabled" }
      : await runCodexSdkStreamProbe(cwd, reportsDir, options.codexStreamTimeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS, env);
  const openaiApiBaseline =
    options.runOpenAiBaseline === false
      ? { ran: false, reason: "OpenAI API baseline disabled", conclusion: "not_tested" as const }
      : await runOpenAiApiBaselineProbe(cwd, options);
  const summary = buildLogprobsProbeSummary({ staticScan, codexSdkRun, codexSdkStream, openaiApiBaseline });
  writeJsonFile(join(reportsDir, "logprobs_probe_summary.json"), summary);
  return { staticScan, codexSdkRun, codexSdkStream, openaiApiBaseline, summary };
}
