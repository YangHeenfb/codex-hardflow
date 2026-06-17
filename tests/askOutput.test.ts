import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runAsk } from "../src/ask/askRunner.js";
import { AskProgressRenderer } from "../src/ask/progressRenderer.js";
import { resolveOutputLanguagePolicy } from "../src/i18n/languagePolicy.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-ask-output-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function runCli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), [join(process.cwd(), "src", "cli.ts"), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CODEX_HARDFLOW_HOME: process.env.CODEX_HARDFLOW_HOME ?? mkdtempSync(join(tmpdir(), "hardflow-state-")) }
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("ask output language policy", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("detects explicit and dominant output languages", () => {
    expect(resolveOutputLanguagePolicy("agent 记忆管理有什么前沿方案？").outputLanguage).toBe("Chinese");
    expect(resolveOutputLanguagePolicy("What are current solutions? 用中文回答").outputLanguage).toBe("Chinese");
    expect(resolveOutputLanguagePolicy("这个项目怎么改? answer in English").outputLanguage).toBe("English");
    expect(resolveOutputLanguagePolicy("日本語で答えて。agent memory の方法は？").outputLanguage).toBe("Japanese");
    expect(resolveOutputLanguagePolicy("responde en español: current agent memory").outputLanguage).toBe("Spanish");
  });

  it("Chinese prompt outputs Chinese headings and keeps source titles/URLs unchanged", async () => {
    const result = await runAsk({
      cwd: tempRepo(),
      rawUserPrompt: "agent 记忆管理方面现在有什么前沿方案？中文回答",
      runId: "run-ask-lang-zh",
      routerProvider: "mock",
      workerProvider: "mock",
      progressMode: "quiet"
    });

    expect(result.outputLanguagePolicy?.outputLanguage).toBe("Chinese");
    expect(result.answer).toContain("问题:");
    expect(result.answer).toContain("基于 HardFlow 证据的回答:");
    expect(result.answer).toContain("覆盖情况:");
    expect(result.answer).toContain("主要来源:");
    expect(result.answer).toContain("Mock official_docs source");
    expect(result.answer).toContain("mock://official_docs");
  });

  it("Japanese and Spanish prompts localize headings", async () => {
    const ja = await runAsk({
      cwd: tempRepo(),
      rawUserPrompt: "日本語で答えて。agent memory の現在の方法は？",
      runId: "run-ask-lang-ja",
      routerProvider: "mock",
      workerProvider: "mock",
      progressMode: "quiet"
    });
    const es = await runAsk({
      cwd: tempRepo(),
      rawUserPrompt: "responde en español: soluciones actuales para memoria de agentes",
      runId: "run-ask-lang-es",
      routerProvider: "mock",
      workerProvider: "mock",
      progressMode: "quiet"
    });

    expect(ja.answer).toContain("質問:");
    expect(ja.answer).toContain("HardFlow の証拠に基づく回答:");
    expect(es.answer).toContain("Pregunta:");
    expect(es.answer).toContain("Respuesta basada en evidencia de HardFlow:");
  });

  it("direct answer preserves requested language policy", async () => {
    const result = await runAsk({
      cwd: tempRepo(),
      rawUserPrompt: "translate hello to Chinese",
      runId: "run-ask-direct-lang",
      routerProvider: "mock",
      workerProvider: "mock",
      progressMode: "quiet",
      directAnswerRunner: async () => "你好"
    });

    expect(result.route).toBe("direct_answer");
    expect(result.outputLanguagePolicy?.outputLanguage).toBe("Chinese");
    expect(result.answer).toBe("你好");
  });

  it("text CLI does not duplicate source and caveat sections", () => {
    const cli = runCli(tempRepo(), [
      "ask",
      "--router-provider",
      "mock",
      "--worker-provider",
      "mock",
      "--no-progress",
      "agent 记忆管理方面现在有什么前沿方案？中文回答"
    ]);

    expect(cli.status).toBe(0);
    expect((cli.stdout.match(/主要来源:/g) ?? []).length).toBe(1);
    expect((cli.stdout.match(/注意事项:/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe("ask progress renderer", () => {
  it("auto TTY mode uses a single-line carriage return", () => {
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "auto", isTty: true, write: (message) => writes.push(message), now: () => 0 });
    renderer.render({ runId: "run-a", status: "researching", completedBucketCount: 1, runningBucketCount: 2, failedBucketCount: 0 }, true);

    expect(writes[0].startsWith("\rHardFlow researching")).toBe(true);
  });

  it("auto non-TTY suppresses duplicate progress lines", () => {
    let now = 0;
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "auto", isTty: false, intervalMs: 10_000, write: (message) => writes.push(message), now: () => now });
    const snapshot = { runId: "run-a", status: "researching", completedBucketCount: 1, runningBucketCount: 2, failedBucketCount: 0 };
    renderer.render(snapshot, true);
    renderer.render(snapshot);
    now = 5_000;
    renderer.render(snapshot);

    expect(writes).toHaveLength(1);
  });

  it("quiet mode prints no progress logs", () => {
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "quiet", write: (message) => writes.push(message) });
    renderer.render({ runId: "run-a", status: "researching" }, true);

    expect(writes).toHaveLength(0);
  });

  it("verbose mode prints detailed progress", () => {
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "verbose", write: (message) => writes.push(message), now: () => 0 });
    renderer.render({ runId: "run-a", status: "researching", retryingBucketCount: 1, slowestWorker: "academic" }, true);

    expect(writes[0]).toContain("retrying=1");
    expect(writes[0]).toContain("slowest=academic");
  });

  it("json mode outputs JSONL events", () => {
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "json", write: (message) => writes.push(message), now: () => 0 });
    renderer.render({ event: "progress", runId: "run-a", status: "researching", completedBucketCount: 2 }, true);
    const parsed = JSON.parse(writes[0]) as { event: string; completedBucketCount: number };

    expect(parsed.event).toBe("progress");
    expect(parsed.completedBucketCount).toBe(2);
  });
});
