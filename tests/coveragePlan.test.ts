import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCoveragePlan } from "../src/coverage/coveragePlan.js";
import { addEvidence, evidenceByBucket, evidenceByPerspective, evidenceByQuestion, listEvidence } from "../src/coverage/evidenceLedger.js";
import { searchEnginesForBucket } from "../src/coverage/searchEngineRegistry.js";
import { evaluateCoverage, selectCoverageRun } from "../src/coverageEval.js";
import { researchRunCoveragePlanPath, researchRunEvidenceLedgerPath } from "../src/paths.js";
import { addManualSourceToReport, addSubagentReport, mergeSubagentReports, runResearch } from "../src/researchOrchestrator.js";
import { broadResearchRouterOutput, currentProjectCompetitorRouterOutput } from "./routerFixtures.js";
import { agentSecurityRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";
import type { RouterOutput } from "../src/router/routerSchema.js";

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
    expect(plan.coverageMode).toBe("exhaustive");
    expect(plan.route).toBe("research");
    expect(plan.researchProfile).toBe("broad");
    expect(plan.sourceBuckets.map((bucket) => bucket.bucket)).toEqual(expect.arrayContaining(["official_docs", "github", "community", "codex_default_discovery"]));
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "codex_default_discovery")?.required).toBe(true);
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "community")).toMatchObject({ required: true, priority: "low" });
    expect(plan.sourceBuckets.every((bucket) => bucket.required)).toBe(true);
    expect(plan.requiredBucketCount).toBe(plan.requiredBuckets.length);
    expect(plan.searchedButNoSignalRequired).toBe(true);
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
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "competitors")).toMatchObject({
      required: true,
      priority: "critical",
      expectedEngines: expect.arrayContaining(["competitor_official_docs", "competitor_github"])
    });
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "official_docs")).toMatchObject({ required: true, priority: "critical" });
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "github")).toMatchObject({ required: true, priority: "critical" });
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "codex_default_discovery")).toMatchObject({ required: true, priority: "critical" });
  });

  it("does not assign coverageMode for direct/simple tasks", () => {
    const plan = buildCoveragePlan(
      routerOutputForBuckets([], {
        route: "direct_answer",
        workflowPattern: "direct",
        researchProfile: "none",
        requiresSourceMatrix: false,
        reasons: ["Direct answer fixture."],
        risks: []
      }),
      "say hello",
      { runId: "run-direct-no-coverage-mode" }
    );

    expect(plan.coverageMode).toBeUndefined();
    expect(plan.sourceBuckets).toEqual([]);
    expect(plan.requiredBuckets).toEqual([]);
  });

  it("honors explicit balanced and fast coverage modes with coverage debt for skipped possible buckets", () => {
    const possibleBuckets = [{ bucket: "github", status: "possible", reason: "GitHub might have adjacent examples." }] as RouterOutput["sourceBuckets"];
    const routerOutput = routerOutputForBuckets([], {
      sourceBuckets: possibleBuckets,
      requiredAgents: []
    });

    const balanced = buildCoveragePlan(routerOutput, "research current agent framework choices", {
      runId: "run-balanced-coverage",
      coverageMode: "balanced"
    });
    const fast = buildCoveragePlan(routerOutput, "research current agent framework choices", {
      runId: "run-fast-coverage",
      coverageMode: "fast"
    });

    expect(balanced.coverageMode).toBe("balanced");
    expect(balanced.sourceBuckets.find((bucket) => bucket.bucket === "github")).toMatchObject({ required: false, priority: "low" });
    expect(balanced.skippedPossibleBuckets).toContain("github");
    expect(balanced.coverageDebt.join("\n")).toContain("github");
    expect(fast.coverageMode).toBe("fast");
  });

  it("requires exhaustive AI coding agent hidden-validation buckets with engines", () => {
    const plan = buildCoveragePlan(agentSecurityRouterOutput, "research AI coding agent hidden validation sandbox evaluation approaches", {
      runId: "run-hidden-validation-exhaustive"
    });

    expect(plan.coverageMode).toBe("exhaustive");
    expect(plan.requiredBuckets).toEqual(
      expect.arrayContaining(["official_docs", "github", "community", "academic", "package_registry", "security", "blogs_engineering", "codex_default_discovery"])
    );
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "community")).toMatchObject({ required: true, priority: "low" });
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "codex_default_discovery")).toMatchObject({ required: true, priority: "critical" });
    for (const bucket of plan.sourceBuckets.filter((entry) => entry.required)) {
      expect(bucket.expectedEngines.length, `${bucket.bucket} expectedEngines`).toBeGreaterThan(0);
    }
  });

  it("requires exhaustive agentic long-horizon buckets for current practical solutions", () => {
    const plan = buildCoveragePlan(broadResearchRouterOutput, "What are current practical solutions for agentic long horizon work? 中文回答", {
      runId: "run-agentic-long-horizon-exhaustive"
    });

    expect(plan.coverageMode).toBe("exhaustive");
    expect(plan.requiredBuckets).toEqual(
      expect.arrayContaining(["official_docs", "github", "community", "academic", "package_registry", "security", "blogs_engineering", "codex_default_discovery"])
    );
    expect(plan.sourceBuckets.every((bucket) => bucket.required)).toBe(true);
    expect(plan.skippedPossibleBuckets).toEqual([]);
  });

  it("upgrades possible buckets in exhaustive mode and records excluded buckets with reasons", () => {
    const routerOutput = routerOutputForBuckets([], {
      sourceBuckets: [
        { bucket: "community", status: "possible", reason: "Community reports may contain weak signal." },
        { bucket: "security", status: "not_needed", reason: "Router fixture says security is logically irrelevant." },
        { bucket: "private_connectors", status: "possible", reason: "Private context might exist." }
      ] as RouterOutput["sourceBuckets"],
      requiredAgents: []
    });

    const plan = buildCoveragePlan(routerOutput, "research current AI coding agent evaluation approaches", {
      runId: "run-exhaustive-upgrades-possible"
    });

    expect(plan.coverageMode).toBe("exhaustive");
    expect(plan.sourceBuckets.every((bucket) => bucket.required)).toBe(true);
    expect(plan.sourceBuckets.find((bucket) => bucket.bucket === "community")?.reason).toContain("Upgraded to required");
    expect(plan.skippedPossibleBuckets).toEqual([]);
    expect(plan.coverageDebt).toEqual([]);
    expect(plan.excludedBuckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: "security", reason: expect.stringContaining("logically irrelevant") }),
        expect.objectContaining({ bucket: "private_connectors", reason: expect.stringContaining("explicit") })
      ])
    );
    expect(plan.sourceBuckets.map((bucket) => bucket.bucket)).not.toContain("security");
    expect(plan.sourceBuckets.map((bucket) => bucket.bucket)).not.toContain("private_connectors");
  });

  it("registers competitors engines with required metadata", () => {
    const engines = searchEnginesForBucket("competitors");
    expect(engines.map((engine) => engine.name)).toEqual(
      expect.arrayContaining(["competitor_official_docs", "competitor_github", "competitor_engineering_blogs", "competitor_product_docs"])
    );
    for (const engine of engines) {
      expect(engine.bucket).toBe("competitors");
      expect(engine.description.length).toBeGreaterThan(10);
      expect(engine.available).toBe(true);
      expect(engine.deterministic).toBe(false);
      expect(engine.requiresNetwork).toBe(true);
      expect(engine.expectedOutputSchema).toBeTruthy();
      expect(engine.defaultLimit).toBe(5);
      expect(engine.riskLevel).toBe("medium");
    }
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
    expect(result.selectedRunId).toBe(report.runId);
    expect(result.selectedRunReason).toBe("explicit --run-id");
    expect(result.completedBucketCount).toBe(result.requiredBucketCount);
    expect(result.completedOrBackfilledBucketCount).toBe(result.requiredBucketCount);
    expect(result.evidenceGatePassed).toBe(true);
    expect(result.uniqueSourceCount).toBe(report.required_buckets.length);
    expect(result.baselinePresent).toBe(false);
    expect(result.broaderThanDefaultClaimAllowed).toBe(false);
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
    expect(result.programmaticTrigger).toBe(true);
    expect(result.programmaticMultiAgent).toBe(false);
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

  it("default coverage eval ignores plumbing/test/audit runs and selects latest evidence parent run", async () => {
    const cwd = tempRepo();
    const ignored = await runResearch("research ignored test plumbing", cwd, {
      sourceRoot: process.cwd(),
      runId: "run-coverage-audit-test",
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-ignored" }
    });
    addManualSourceToReport(cwd, {
      runId: ignored.runId,
      bucket: "official_docs",
      title: "Ignored source",
      url_or_ref: "https://example.com/ignored",
      claim: "Ignored test run source."
    });

    const selected = await runResearch("research selected latest evidence", cwd, {
      sourceRoot: process.cwd(),
      runId: "run-selected-evidence",
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-selected" }
    });
    addManualSourceToReport(cwd, {
      runId: selected.runId,
      bucket: "official_docs",
      title: "Selected source",
      url_or_ref: "https://example.com/selected",
      claim: "Selected run source."
    });

    const result = evaluateCoverage(cwd, {});
    expect(result.selectedRunId).toBe(selected.runId);
    expect(result.selectedRunReason).toContain("selected latest evidence-bearing parent run");
  });

  it("default coverage eval can include test runs when requested", async () => {
    const cwd = tempRepo();
    const testRun = await runResearch("research selected test run", cwd, {
      sourceRoot: process.cwd(),
      runId: "run-test-evidence",
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-test-selected" }
    });
    addManualSourceToReport(cwd, {
      runId: testRun.runId,
      bucket: "official_docs",
      title: "Test source",
      url_or_ref: "https://example.com/test",
      claim: "Test run source."
    });

    expect(selectCoverageRun(cwd, { includeTestRuns: true }).runId).toBe(testRun.runId);
  });

  it("default coverage eval errors when no evidence-bearing parent run exists", () => {
    const cwd = tempRepo();
    expect(() => evaluateCoverage(cwd, {})).toThrow("No evidence-bearing parent research run found; pass --run-id.");
  });

  it("valid baseline computes delta metrics and enables broader-than-default comparison", async () => {
    const cwd = tempRepo();
    const baseline = await runResearch("research baseline", cwd, {
      sourceRoot: process.cwd(),
      runId: "run-baseline",
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-baseline" }
    });
    addManualSourceToReport(cwd, {
      runId: baseline.runId,
      bucket: "official_docs",
      title: "Baseline docs",
      source_type: "official_docs",
      url_or_ref: "https://example.com/baseline",
      claim: "Baseline docs reviewed."
    });
    const hardflow = await runResearch("research hardflow", cwd, {
      sourceRoot: process.cwd(),
      runId: "run-hardflow-baseline-compare",
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-hardflow-baseline" }
    });
    for (const bucket of hardflow.required_buckets) {
      addManualSourceToReport(cwd, {
        runId: hardflow.runId,
        bucket,
        title: `${bucket} source`,
        source_type: bucket,
        url_or_ref: `https://example.com/${bucket}`,
        claim: `${bucket} source reviewed.`
      });
    }

    const result = evaluateCoverage(cwd, { runId: hardflow.runId, baselineRunId: baseline.runId });
    expect(result.baselinePresent).toBe(true);
    expect(result.broaderThanDefaultClaimAllowed).toBe(true);
    expect(result.deltaSourceCount).toBeGreaterThan(0);
    expect(result.deltaBucketCoverageRatio).toBeGreaterThan(0);
    expect(result.deltaCoverageScore).toBeDefined();
  });

  it("invalid empty baseline does not allow broader-than-default claims", async () => {
    const cwd = tempRepo();
    const baseline = await runResearch("research empty baseline", cwd, {
      sourceRoot: process.cwd(),
      runId: "run-empty-baseline",
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-empty-baseline" }
    });
    const hardflow = await runResearch("research hardflow no baseline claim", cwd, {
      sourceRoot: process.cwd(),
      runId: "run-hardflow-no-baseline-claim",
      routerOutput: broadResearchRouterOutput,
      runnerMode: "app_handoff",
      input: { turnId: "turn-hardflow-no-baseline" }
    });
    addManualSourceToReport(cwd, {
      runId: hardflow.runId,
      bucket: "official_docs",
      title: "Hardflow docs",
      source_type: "official_docs",
      url_or_ref: "https://example.com/hardflow",
      claim: "Hardflow docs reviewed."
    });

    const result = evaluateCoverage(cwd, { runId: hardflow.runId, baselineRunId: baseline.runId });
    expect(result.baselinePresent).toBe(false);
    expect(result.broaderThanDefaultClaimAllowed).toBe(false);
  });
});
