import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { createHookMarker, markerPathFor, updateMarker, type HookMarker } from "../src/hookState.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { stopValidationGate } from "../src/hooks/stopValidationGate.js";
import { buildResearchReport } from "../src/researchOrchestrator.js";
import { repoHash, researchReportPath } from "../src/paths.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-hook-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  mkdirSync(join(dir, ".agent", "manifests"), { recursive: true });
  return dir;
}

function writeReport(cwd: string, marker: HookMarker, prompt: string, generatedAt?: string): void {
  const report = buildResearchReport(prompt);
  report.generatedAt = generatedAt ?? new Date(Date.parse(marker.createdAt) + 1_000).toISOString();
  writeFileSync(researchReportPath(cwd), `${JSON.stringify(report, null, 2)}\n`);
}

describe("hook marker Stop gate", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("UserPromptSubmit writes a turn-scoped marker with the required schema", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "research current AI coding agent hidden validation sandbox evaluation framework",
        turnId: "turn-schema",
        sessionId: "thread-schema"
      },
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    const context = String((result.hookSpecificOutput as Record<string, unknown>).additionalContext);
    expect((result.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(context).toContain("research_report.json");
    expect(context).toContain("promptHash=");
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-schema"), "utf8")) as HookMarker;
    expect(marker.turnId).toBe("turn-schema");
    expect(marker.cwdHash).toBe(repoHash(cwd));
    expect(marker.taskType).toBe("research-heavy");
    expect(marker.requiresSourceMatrix).toBe(true);
    expect(marker.maxBlocks).toBe(2);
  });

  it("does not let a stale research_report satisfy the current marker", () => {
    const cwd = tempRepo();
    const prompt = "research current AI coding agent hidden validation sandbox evaluation framework";
    const marker = createHookMarker({
      cwd,
      prompt,
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-stale" }
    });
    writeReport(cwd, marker, prompt, new Date(Date.parse(marker.createdAt) - 1_000).toISOString());

    expect(stopValidationGate({ cwd, turnId: "turn-stale" }).decision).toBe("block");
  });

  it("does not use another turn marker to block the current turn", () => {
    const cwd = tempRepo();
    createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-other" }
    });

    expect(stopValidationGate({ cwd, turnId: "turn-current" }).decision).toBe("allow");
  });

  it("allows expired and completed markers", () => {
    const cwd = tempRepo();
    const expired = createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-expired" },
      ttlMs: -1
    });
    expect(stopValidationGate({ cwd, turnId: expired.turnId }).decision).toBe("allow");

    const completed = createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-completed" }
    });
    updateMarker(completed, { status: "completed" });
    expect(stopValidationGate({ cwd, turnId: completed.turnId }).decision).toBe("allow");
  });

  it("allows after maxBlocks is reached with an explicit failure explanation", () => {
    const cwd = tempRepo();
    const marker = createHookMarker({
      cwd,
      prompt: "research current security architecture",
      sourceRoot: process.cwd(),
      taskType: "research-heavy",
      requiresSourceMatrix: true,
      requiresExecutorManifest: false,
      requiresValidation: false,
      input: { turnId: "turn-max-blocks" }
    });
    updateMarker(marker, { blockCount: marker.maxBlocks });

    const result = stopValidationGate({ cwd, turnId: marker.turnId });
    expect(result.decision).toBe("allow");
    expect(result.hardflowStatus).toBe("failed_max_blocks_reached");
  });

  it("allows no-HEAD repos with untracked files when there is no marker", () => {
    const cwd = tempRepo();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    writeFileSync(join(cwd, "new-file.ts"), "export const x = 1;\n");

    expect(stopValidationGate({ cwd }).decision).toBe("allow");
  });

  it("allows hardflow maintenance markers without business executor_manifest", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "修复 codex-hardflow Stop hook PATH install-global",
        turnId: "turn-maintenance",
        sessionId: "thread-maintenance"
      },
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    expect(stopValidationGate({ cwd, turnId: "turn-maintenance" }).decision).toBe("allow");
  });
});
