import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-report-cli-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function runCli(cwd: string, args: string[], input?: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), [join(process.cwd(), "src", "cli.ts"), ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, CODEX_HARDFLOW_HOME: process.env.CODEX_HARDFLOW_HOME ?? mkdtempSync(join(tmpdir(), "hardflow-state-")) }
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function jsonOutput<T>(result: { status: number | null; stdout: string; stderr: string }): T {
  if (result.status !== 0) throw new Error(`CLI failed: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout) as T;
}

describe("report CLI", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("report add-source updates searched_sources_table from JSON stdin", () => {
    const cwd = tempRepo();
    const prompt = "research current onboarding patterns for product teams";
    jsonOutput(runCli(cwd, ["research", "--runner", "app_handoff", "--raw-user-prompt", prompt, prompt]));

    const report = jsonOutput<{ searched_sources_table: unknown[]; bucket_statuses: Record<string, string> }>(
      runCli(
        cwd,
        ["report", "add-source"],
        JSON.stringify({
          bucket: "official_docs",
          title: "Official docs",
          source_type: "official_docs",
          url_or_ref: "https://example.com/docs",
          date_or_version: "2026-06-09",
          claim: "Official documentation reviewed.",
          confidence: "high",
          finding: "Official docs provide primary evidence.",
          citation: "https://example.com/docs"
        })
      )
    );

    expect(report.searched_sources_table).toHaveLength(1);
    expect(report.bucket_statuses.official_docs).toBe("manual_backfilled");
  });

  it("report finalize-manual recomputes status and report assert-evidence passes", () => {
    const cwd = tempRepo();
    const prompt = "research current onboarding patterns for product teams";
    jsonOutput(runCli(cwd, ["research", "--runner", "app_handoff", "--raw-user-prompt", prompt, prompt]));

    for (const bucket of ["official_docs", "github", "community", "codex_default_discovery"]) {
      jsonOutput(
        runCli(cwd, [
          "report",
          "add-source",
          "--bucket",
          bucket,
          "--title",
          `${bucket} source`,
          "--url",
          `https://example.com/${bucket}`,
          "--claim",
          `${bucket} source reviewed.`,
          "--finding",
          `${bucket} finding recorded.`
        ])
      );
    }

    const finalized = jsonOutput<{ status: string; confidence_summary: string }>(
      runCli(
        cwd,
        ["report", "finalize-manual"],
        JSON.stringify({
          confidenceSummary: "Manual App handoff sources cover the required critical buckets.",
          sourceGaps: []
        })
      )
    );
    const assertion = jsonOutput<{ passed: boolean }>(runCli(cwd, ["report", "assert-evidence"]));

    expect(finalized.status).toBe("completed");
    expect(finalized.confidence_summary).toContain("Manual App handoff");
    expect(assertion.passed).toBe(true);
  });
});
