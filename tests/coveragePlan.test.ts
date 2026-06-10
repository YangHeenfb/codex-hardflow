import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCoveragePlan } from "../src/coverage/coveragePlan.js";
import { addEvidence, evidenceByBucket, evidenceByPerspective, evidenceByQuestion, listEvidence } from "../src/coverage/evidenceLedger.js";
import { searchEnginesForBucket } from "../src/coverage/searchEngineRegistry.js";
import { evaluateCoverage } from "../src/coverageEval.js";
import { researchRunCoveragePlanPath, researchRunEvidenceLedgerPath } from "../src/paths.js";
import { addManualSourceToReport, addSubagentReport, mergeSubagentReports, runResearch } from "../src/researchOrchestrator.js";
import { broadResearchRouterOutput, currentProjectCompetitorRouterOutput } from "./routerFixtures.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-coverage-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

describe("CoveragePlan and EvidenceLedger", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("builds a broad research CoveragePlan from routerOutput", () => {
    const plan = buildCoveragePlan(broadResearchRouterOutput, "research current agent framework choices", {
      runId: "run-plan-broad",
      normalizedTask: "research current agent framework choices"
    });

    expect(plan.runId).toBe("run-plan-broad");
    expect(plan.route).toBe("research");
    expect(plan.researchProfile).toBe("broad");
    expect(plan.sourceBuckets.map((bucket) => bucket.bucket)).toEqual(expect.arrayContaining(["official_docs", "github", "community", "codex_default_discovery"]));
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "codex_default_discovery")?.required).toBe(true);
    expect(plan.budget.breadth).toBeGreaterThanOrEqual(5);
    expect(plan.budget.depth).toBeGreaterThanOrEqual(2);
    expect(plan.gates.requireEvidenceLedger).toBe(true);
    expect(plan.gates.requireNoSignalRecords).toBe(true);
    expect(plan.perspectives.length).toBeGreaterThan(0);
    expect(plan.researchQuestions.length).toBeGreaterThanOrEqual(plan.sourceBuckets.length);
  });

  it("marks local_repo and competitors critical for local_repo_plus_external", () => {
    const plan = buildCoveragePlan(currentProjectCompetitorRouterOutput, "compare this repo with similar projects", {
      runId: "run-local-external"
    });

    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "local_repo")).toMatchObject({ required: true, priority: "critical" });
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "competitors")).toMatchObject({ required: true, priority: "critical" });
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "official_docs")?.priority).toBe("normal");
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "github")?.priority).toBe("normal");
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "codex_default_discovery")?.priority).toBe("normal");
  });

  it("lists registered engines and records unavailable engines in plans", () => {
    expect(searchEnginesForBucket("github").map((engine) => engine.name)).toEqual(expect.arrayContaining(["github_repos", "github_issues", "github_discussions"]));
    expect(searchEnginesForBucket("security").map((engine) => engine.name)).toEqual(
      expect.arrayContaining(["nvd", "github_security_advisories", "snyk", "vendor_advisories"])
    );

    const plan = buildCoveragePlan(
      {
        ...broadResearchRouterOutput,
        sourceBuckets: [{ bucket: "academic", status: "required", reason: "Academic evidence requested." }]
      },
      "research academic evidence",
      { runId: "run-academic-engines" }
    );
    expect(plan.searchEngines.find((engine) => engine.engine === "google_scholar_if_available")).toMatchObject({
      enabled: false,
      bucket: "academic"
    });
  });

  it("adds, lists, and filters evidence ledger items", () => {
    const cwd = tempRepo();
    addEvidence(cwd, {
      runId: "run-ledger",
      bucket: "official_docs",
      engine: "web_official_docs",
      query: "official docs query",
      sourceType: "official_docs",
      title: "Official docs",
      urlOrRef: "https://example.com/docs",
      dateOrVersion: "2026-06-10",
      claim: "Official docs reviewed.",
      confidence: "high",
      perspectiveId: "primary_answer",
      researchQuestionId: "q_1_official_docs"
    });

    expect(listEvidence(cwd, "run-ledger")).toHaveLength(1);
    expect(evidenceByBucket(cwd, "run-ledger", "official_docs")).toHaveLength(1);
    expect(evidenceByQuestion(cwd, "run-ledger", "q_1_official_docs")).toHaveLength(1);
    expect(evidenceByPerspective(cwd, "run-ledger", "primary_answer")).toHaveLength(1);
    expect(existsSync(researchRunEvidenceLedgerPath(cwd, "run-ledger"))).toBe(true);
  });

  it("writes CoveragePlan during research and bridges manual add-source to EvidenceLedger", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-manual-ledger" }
    });

    addManualSourceToReport(cwd, {
      runId: report.runId,
      bucket: "official_docs",
      title: "Official docs",
      source_type: "official_docs",
      url_or_ref: "https://example.com/docs",
      claim: "Official docs reviewed."
    });

    expect(existsSync(researchRunCoveragePlanPath(cwd, report.runId))).toBe(true);
    expect(listEvidence(cwd, report.runId)).toMatchObject([
      {
        bucket: "official_docs",
        engine: "manual_backfill",
        sourceType: "official_docs",
        title: "Official docs"
      }
    ]);
  });

  it("coverage eval uses EvidenceLedger when present", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-ledger-eval" }
    });

    for (const bucket of report.required_buckets) {
      addEvidence(cwd, {
        runId: report.runId,
        bucket,
        engine: "manual_backfill",
        query: `${bucket} query`,
        sourceType: bucket,
        title: `${bucket} source`,
        urlOrRef: `https://example.com/${bucket}`,
        dateOrVersion: "2026-06-10",
        claim: `${bucket} source reviewed.`,
        confidence: "medium"
      });
    }

    const result = evaluateCoverage(cwd, { runId: report.runId });
    expect(result.completedBucketCount).toBe(result.requiredBucketCount);
    expect(result.evidenceGatePassed).toBe(true);
    expect(result.uniqueSourceCount).toBe(report.required_buckets.length);
  });

  it("does not require App subagent spawn when EvidenceLedger satisfies required buckets", async () => {
    const cwd = tempRepo();
    const report = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-not-spawned-ledger-passes" }
    });

    for (const bucket of report.required_buckets) {
      addManualSourceToReport(cwd, {
        runId: report.runId,
        bucket,
        title: `${bucket} source`,
        source_type: bucket,
        url_or_ref: `https://example.com/${bucket}`,
        claim: `${bucket} source reviewed.`
      });
    }

    const result = evaluateCoverage(cwd, { runId: report.runId });
    expect(result.subagentSpawnedCount).toBe(0);
    expect(result.evidenceGatePassed).toBe(true);
    expect(result.bucketCoverageRatio).toBe(1);
  });

  it("does not pass coverage from spawned subagent status without enough evidence", async () => {
    const cwd = tempRepo();
    const parent = await runResearch("research current agent framework choices", cwd, {
      sourceRoot: process.cwd(),
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-spawned-no-evidence" }
    });
    addSubagentReport(cwd, {
      parentRunId: parent.runId,
      agent: "official_docs_researcher",
      bucket: "official_docs",
      status: "completed",
      sources_found: [],
      searched_but_no_signal: true,
      queries_run: ["official docs query"]
    });
    mergeSubagentReports(cwd, parent.runId);

    const result = evaluateCoverage(cwd, { runId: parent.runId });
    expect(result.subagentSpawnedCount).toBeGreaterThan(0);
    expect(result.uniqueSourceCount).toBe(0);
    expect(result.evidenceGatePassed).toBe(false);
    expect(result.coverage_claim).toBe("hardflow coverage is broad by configured matrix");
    expect(result.coverage_claim).not.toContain("default Codex search");
  });
});
