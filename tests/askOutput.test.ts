import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { EvidenceItem } from "../src/coverage/evidenceLedger.js";
import { runAsk } from "../src/ask/askRunner.js";
import { synthesizeAnswerBodyWithProvider } from "../src/ask/answerSynthesisProvider.js";
import { AskProgressRenderer } from "../src/ask/progressRenderer.js";
import { resolveOutputLanguagePolicy } from "../src/i18n/languagePolicy.js";
import { createHardflowJob, failHardflowJob } from "../src/jobs/jobStore.js";
import type { ResearchReport } from "../src/schemas.js";

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
    expect(resolveOutputLanguagePolicy("agent 记忆管理有什么前沿方案？").confidence).toBeGreaterThan(0);
    expect(resolveOutputLanguagePolicy("What are current solutions? 用中文回答").outputLanguage).toBe("Chinese");
    expect(resolveOutputLanguagePolicy("这个项目怎么改? answer in English").outputLanguage).toBe("English");
    expect(resolveOutputLanguagePolicy("日本語で答えて。agent memory の方法は？").outputLanguage).toBe("Japanese");
    expect(resolveOutputLanguagePolicy("한국어로 답해. agent memory 방법은?").outputLanguage).toBe("Korean");
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
    expect(result.answer).toContain("回答:");
    expect(result.answer).toContain("覆盖情况:");
    expect(result.answer).toContain("主要来源:");
    expect(result.answer).toContain("共 ");
    expect(result.answer).not.toContain("Mock evidence for official_docs.");
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
    expect(ja.answer).toContain("回答:");
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

  it("Chinese prompt wraps router failures in localized user-facing text", async () => {
    const cwd = tempRepo();
    createHardflowJob({
      runId: "run-ask-router-failed-zh",
      cwd,
      rawUserPrompt: "agent 记忆管理方面现在有什么前沿方案？",
      promptHash: "hash",
      turnId: "turn-router-failed-zh",
      triggerSource: "cli"
    });
    failHardflowJob(cwd, "run-ask-router-failed-zh", "Router output failed schema after normalization and repair retry: sourceBuckets[6].status invalid", {
      route: "router_failed"
    });

    const result = await runAsk({ cwd, fromRunId: "run-ask-router-failed-zh", progressMode: "quiet" });

    expect(result.status).toBe("failed");
    expect(result.answer).toContain("路由失败:");
    expect(result.answer).toContain("详情:");
    expect(result.failureReason).toContain("Router output failed schema");
  });

  it("codex_cli answer synthesis does not block the Node event loop", async () => {
    const cwd = tempRepo();
    const binDir = mkdtempSync(join(tmpdir(), "hardflow-fake-codex-bin-"));
    const sourceCodexHome = join(cwd, "source-codex-home");
    const fakeCodex = join(binDir, "codex");
    mkdirSync(sourceCodexHome);
    writeFileSync(join(sourceCodexHome, "auth.json"), "{}\n");
    writeFileSync(
      fakeCodex,
      `#!/bin/sh
cat >/dev/null
sleep 0.1
printf '合成答案'
`
    );
    chmodSync(fakeCodex, 0o755);
    const previousPath = process.env.PATH;
    const previousSourceHome = process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME = sourceCodexHome;
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 20);
    const item: EvidenceItem = {
      id: "ev-1",
      runId: "run-synthesis-async",
      bucket: "official_docs",
      engine: "official",
      query: "q",
      sourceType: "official_docs",
      title: "Official source",
      urlOrRef: "https://example.com",
      dateOrVersion: "",
      claim: "English claim",
      confidence: "high",
      retrievedAt: new Date().toISOString(),
      perspectiveId: null,
      researchQuestionId: null
    };
    const report = {
      status: "completed",
      runner_mode: "strict_programmatic",
      coverageMode: "exhaustive",
      parallelPolicy: "all_required",
      required_buckets: ["official_docs"],
      searched_but_no_signal: [],
      excludedBuckets: [],
      useful_findings: [],
      source_gaps: [],
      failure_reason: ""
    } as unknown as ResearchReport;

    try {
      const result = await synthesizeAnswerBodyWithProvider({
        cwd,
        runId: "run-synthesis-async",
        rawUserPrompt: "中文回答",
        report,
        items: [item],
        coverage: null,
        coverageSummary: {
          coverageMode: "exhaustive",
          parallelPolicy: "all_required",
          requiredBucketCount: 1,
          completedRequiredBucketCount: 1,
          searchedButNoSignalCount: 0,
          excludedBucketCount: 0,
          sourceCount: 1,
          evidenceItemCount: 1,
          coverageScore: 100,
          coverageClaim: null
        },
        languagePolicy: resolveOutputLanguagePolicy("中文回答"),
        provider: "codex_cli"
      });

      expect(result.answerBody).toBe("合成答案");
      expect(timerFired).toBe(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousSourceHome === undefined) delete process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME;
      else process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME = previousSourceHome;
    }
  });
});

describe("ask progress renderer", () => {
  it("auto TTY mode uses a single-line carriage return", () => {
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "auto", isTty: true, write: (message) => writes.push(message), now: () => 0 });
    renderer.render({ runId: "run-a", status: "researching", completedBucketCount: 1, runningBucketCount: 2, failedBucketCount: 0 }, true);

    expect(writes[0].startsWith("\x1b[2K\rHardFlow ")).toBe(true);
    expect(writes[0]).toContain("\x1b[7mr\x1b[0mesearching");
  });

  it("auto TTY mode redraws animated frames without a new snapshot", () => {
    let now = 0;
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({
      mode: "auto",
      isTty: true,
      frameIntervalMs: 150,
      write: (message) => writes.push(message),
      now: () => now
    });
    const snapshot = { runId: "run-a", status: "researching", completedBucketCount: 1, runningBucketCount: 2, failedBucketCount: 0 };
    renderer.render(snapshot, true);
    now = 149;
    renderer.render(snapshot);
    now = 150;
    renderer.render(snapshot);

    expect(writes).toHaveLength(2);
    expect(writes[0]).not.toBe(writes[1]);
    expect(writes[1]).toContain("r\x1b[7me\x1b[0msearching");
  });

  it("finish adds a newline after a TTY carriage-return status line", () => {
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "auto", isTty: true, write: (message) => writes.push(message), now: () => 0 });
    renderer.render({ runId: "run-a", status: "pending" }, true);
    renderer.finish();

    expect(writes).toEqual([expect.stringMatching(/^\x1b\[2K\rHardFlow \x1b\[7mq\x1b\[0mueued/), "\x1b[2K\r\n"]);
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

  it("minimal TTY mode clears the current line", () => {
    const writes: string[] = [];
    const renderer = new AskProgressRenderer({ mode: "minimal", isTty: true, write: (message) => writes.push(message), now: () => 0 });
    renderer.render({ runId: "run-minimal", status: "researching", elapsedMs: 65_000 }, true);

    expect(writes[0]).toContain("\x1b[2K\rHardFlow ");
    expect(writes[0]).toContain("01:05");
    expect(writes[0]).not.toContain("run ...");
  });
});
