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

interface CliResearchReport {
  runId: string;
  searched_sources_table: unknown[];
  useful_findings: string[];
  status: string;
}

describe("report CLI", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("report add-source updates searched_sources_table from JSON stdin", () => {
    const cwd = tempRepo();
    const prompt = "research current onboarding patterns for product teams";
    const initial = jsonOutput<CliResearchReport>(runCli(cwd, ["research", "--runner", "app_handoff", "--raw-user-prompt", prompt, prompt]));
    expect(initial.runId).toBeTruthy();

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

  it("report add-source with explicit runId writes the selected report", () => {
    const cwd = tempRepo();
    const first = jsonOutput<CliResearchReport>(runCli(cwd, ["research", "--run-id", "run-a", "--runner", "app_handoff", "research current onboarding patterns"]));
    const second = jsonOutput<CliResearchReport>(runCli(cwd, ["research", "--run-id", "run-b", "--runner", "app_handoff", "research current onboarding patterns"]));

    jsonOutput(
      runCli(cwd, [
        "report",
        "add-source",
        "--run-id",
        first.runId,
        "--bucket",
        "official_docs",
        "--title",
        "Run A source",
        "--url",
        "https://example.com/run-a",
        "--claim",
        "Run A source reviewed."
      ])
    );

    const a = jsonOutput<CliResearchReport>(runCli(cwd, ["report", "show", "--run-id", first.runId]));
    const b = jsonOutput<CliResearchReport>(runCli(cwd, ["report", "show", "--run-id", second.runId]));
    expect(a.searched_sources_table).toHaveLength(1);
    expect(b.searched_sources_table).toHaveLength(0);
  });

  it("report finalize-manual with runId recomputes only that report", () => {
    const cwd = tempRepo();
    const first = jsonOutput<CliResearchReport>(runCli(cwd, ["research", "--run-id", "run-final-a", "--runner", "app_handoff", "research current onboarding patterns"]));
    const second = jsonOutput<CliResearchReport>(runCli(cwd, ["research", "--run-id", "run-final-b", "--runner", "app_handoff", "research current onboarding patterns"]));
    jsonOutput(
      runCli(cwd, [
        "report",
        "add-source",
        "--run-id",
        first.runId,
        "--bucket",
        "official_docs",
        "--title",
        "Run A source",
        "--url",
        "https://example.com/run-a",
        "--claim",
        "Run A source reviewed."
      ])
    );
    jsonOutput(runCli(cwd, ["report", "finalize-manual", "--run-id", first.runId, "--useful-finding", "Run A finding"]));

    const a = jsonOutput<CliResearchReport>(runCli(cwd, ["report", "show", "--run-id", first.runId]));
    const b = jsonOutput<CliResearchReport>(runCli(cwd, ["report", "show", "--run-id", second.runId]));
    expect(a.useful_findings).toContain("Run A finding");
    expect(b.useful_findings).not.toContain("Run A finding");
  });

  it("report add-subagent-report and merge-subagents use the parent runId", () => {
    const cwd = tempRepo();
    const parent = jsonOutput<CliResearchReport>(runCli(cwd, ["research", "--run-id", "run-subagent-cli", "--runner", "app_handoff", "research current onboarding patterns"]));

    jsonOutput(
      runCli(
        cwd,
        ["report", "add-subagent-report", "--run-id", parent.runId],
        JSON.stringify({
          agent: "github_researcher",
          bucket: "github",
          status: "completed",
          sources_found: [
            {
              bucket: "github",
              title: "GitHub repo",
              source_type: "github",
              url_or_ref: "https://github.com/example/repo",
              date_or_version: "2026-06-09",
              claim: "Repository reviewed.",
              confidence: "medium",
              notes: "Subagent CLI report."
            }
          ],
          queries_run: ["github query"]
        })
      )
    );
    const merged = jsonOutput<CliResearchReport>(runCli(cwd, ["report", "merge-subagents", "--run-id", parent.runId]));

    expect(merged.searched_sources_table).toHaveLength(1);
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
