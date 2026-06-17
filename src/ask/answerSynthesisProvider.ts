import { spawnSync } from "node:child_process";
import { hardflowRunCodexHome } from "../paths.js";
import { prepareIsolatedCodexHome } from "../codexHomeIsolation.js";
import { runIsolatedCodexPrompt } from "../codexRunner.js";
import { internalEnvFor } from "../internalEnv.js";
import type { CoverageEvalResult } from "../coverageEval.js";
import type { EvidenceItem } from "../coverage/evidenceLedger.js";
import { isNoSignalEvidence } from "../coverage/evidenceLedger.js";
import { languageInstruction, outputLanguageCode, type OutputLanguagePolicy } from "../i18n/languagePolicy.js";
import type { ResearchReport } from "../schemas.js";
import type { AskCoverageSummary } from "./answerSynthesis.js";

export type AnswerSynthesisProvider = "codex_cli" | "codex_sdk" | "mock";

export interface AnswerSynthesisProviderOptions {
  cwd: string;
  runId: string;
  rawUserPrompt: string;
  report: ResearchReport;
  items: EvidenceItem[];
  coverage: CoverageEvalResult | null;
  coverageSummary: AskCoverageSummary;
  languagePolicy: OutputLanguagePolicy;
  provider: AnswerSynthesisProvider;
  timeoutMs?: number;
}

export interface AnswerSynthesisProviderResult {
  answerBody: string;
  provider: AnswerSynthesisProvider;
  warning: string | null;
}

function compactEvidence(items: EvidenceItem[]): Array<Record<string, string>> {
  return items
    .filter((item) => !isNoSignalEvidence(item))
    .slice(0, 40)
    .map((item) => ({
      id: item.id,
      bucket: item.bucket,
      title: item.title,
      urlOrRef: item.urlOrRef,
      claim: item.claim,
      confidence: item.confidence
    }));
}

function compactReport(report: ResearchReport): Record<string, unknown> {
  return {
    status: report.status,
    runner_mode: report.runner_mode,
    coverageMode: report.coverageMode,
    parallelPolicy: report.parallelPolicy,
    required_buckets: report.required_buckets,
    searched_but_no_signal: report.searched_but_no_signal,
    excludedBuckets: report.excludedBuckets,
    useful_findings: report.useful_findings,
    source_gaps: report.source_gaps,
    failure_reason: report.failure_reason
  };
}

function buildSynthesisPrompt(options: AnswerSynthesisProviderOptions): string {
  const payload = {
    question: options.rawUserPrompt,
    languagePolicy: options.languagePolicy,
    coverageSummary: options.coverageSummary,
    coverageEval: options.coverage,
    report: compactReport(options.report),
    evidence: compactEvidence(options.items)
  };
  return [
    "You are the codex-hardflow final answer synthesizer.",
    languageInstruction(options.languagePolicy),
    "Use only the supplied research_report and EvidenceLedger payload.",
    "Do not browse, do not call tools, and do not introduce unsupported claims.",
    "Do not paste EvidenceLedger claim strings as final bullets. Synthesize their meaning.",
    "If the evidence is in English but the requested output language is different, summarize the meaning in the requested language.",
    "Keep source titles, URLs, evidence IDs, product names, paper titles, package names, and API names unchanged.",
    "Return only the final answer body. Do not include Sources, Coverage, Caveats, Run info, or markdown headings; the CLI prints those separately.",
    "Be concise and concrete. Mention uncertainty when evidence is thin.",
    "",
    "Payload JSON:",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function fallbackBody(options: AnswerSynthesisProviderOptions): string {
  const buckets = Array.from(new Set(options.items.filter((item) => !isNoSignalEvidence(item)).map((item) => item.bucket))).join(", ") || "n/a";
  const code = outputLanguageCode(options.languagePolicy.outputLanguage);
  if (code === "zh") {
    return [
      `本次研究覆盖 ${options.coverageSummary.completedRequiredBucketCount}/${options.coverageSummary.requiredBucketCount} 个必查来源桶，共 ${options.coverageSummary.evidenceItemCount} 条证据。`,
      `证据主要来自：${buckets}。`,
      "由于当前使用本地 fallback 合成，这里只给出保守摘要；具体来源见下方来源列表和完整报告。"
    ].join("\n");
  }
  if (code === "ja") {
    return [
      `今回の研究は必須バケット ${options.coverageSummary.completedRequiredBucketCount}/${options.coverageSummary.requiredBucketCount} 件をカバーし、${options.coverageSummary.evidenceItemCount} 件の証拠を収集しました。`,
      `主な証拠バケット: ${buckets}.`,
      "これはローカル fallback 合成による保守的な要約です。詳細は下のソース一覧と完全なレポートを参照してください。"
    ].join("\n");
  }
  if (code === "es") {
    return [
      `La investigación cubrió ${options.coverageSummary.completedRequiredBucketCount}/${options.coverageSummary.requiredBucketCount} buckets requeridos y reunió ${options.coverageSummary.evidenceItemCount} elementos de evidencia.`,
      `Buckets principales: ${buckets}.`,
      "Este es un resumen conservador generado por fallback local; consulta las fuentes y el reporte completo para los detalles."
    ].join("\n");
  }
  return [
    `The research covered ${options.coverageSummary.completedRequiredBucketCount}/${options.coverageSummary.requiredBucketCount} required buckets and collected ${options.coverageSummary.evidenceItemCount} evidence items.`,
    `Main evidence buckets: ${buckets}.`,
    "This is a conservative local fallback synthesis; see the source list and full report for details."
  ].join("\n");
}

function sanitizeOutput(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 4000);
}

function runCodexCliSynthesis(prompt: string, options: AnswerSynthesisProviderOptions): string {
  const isolatedCodexHome = prepareIsolatedCodexHome(hardflowRunCodexHome(options.cwd, options.runId));
  const env = internalEnvFor({ ...process.env, CODEX_HOME: isolatedCodexHome }, "answer_synthesis", options.runId);
  const result = spawnSync("codex", ["exec", "--skip-git-repo-check", "--ignore-rules", "--sandbox", "read-only"], {
    cwd: options.cwd,
    env,
    input: prompt,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 180_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codex_cli answer synthesis exited with status ${result.status ?? "unknown"}: ${sanitizeOutput(result.stderr ?? result.stdout ?? "")}`);
  }
  return (result.stdout ?? "").trim();
}

async function runCodexSdkSynthesis(prompt: string, options: AnswerSynthesisProviderOptions): Promise<string> {
  const isolatedCodexHome = prepareIsolatedCodexHome(hardflowRunCodexHome(options.cwd, options.runId));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = isolatedCodexHome;
  try {
    return (
      await runIsolatedCodexPrompt(prompt, options.cwd, true, {
        purpose: "answer_synthesis",
        parentRunId: options.runId
      })
    ).trim();
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
}

export async function synthesizeAnswerBodyWithProvider(options: AnswerSynthesisProviderOptions): Promise<AnswerSynthesisProviderResult> {
  if (options.provider === "mock") {
    return { answerBody: fallbackBody(options), provider: "mock", warning: null };
  }
  const prompt = buildSynthesisPrompt(options);
  try {
    const answerBody =
      options.provider === "codex_cli" ? runCodexCliSynthesis(prompt, options) : await runCodexSdkSynthesis(prompt, options);
    if (!answerBody) throw new Error("empty answer synthesis response");
    return { answerBody, provider: options.provider, warning: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      answerBody: fallbackBody(options),
      provider: options.provider,
      warning: reason
    };
  }
}
