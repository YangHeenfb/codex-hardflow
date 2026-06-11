import { describe, expect, it } from "vitest";
import { applyDefaultDiscoveryFindings, buildSourceCoverageMatrix } from "../src/sourceMatrix.js";
import { buildResearchReport } from "../src/researchOrchestrator.js";
import { agentSecurityRouterOutput, broadResearchRouterOutput, currentProjectCompetitorRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";

describe("source matrix", () => {
  it("classifies research-heavy troubleshooting with codex_default_discovery", () => {
    const matrix = buildSourceCoverageMatrix("troubleshoot the latest Next.js auth package error", {
      routerOutput: routerOutputForBuckets(["official_docs", "github", "community", "package_registry", "security", "codex_default_discovery"])
    });
    expect(matrix.requiredBuckets).toContain("official_docs");
    expect(matrix.requiredBuckets).toContain("github");
    expect(matrix.requiredBuckets).toContain("community");
    expect(matrix.requiredBuckets).toContain("package_registry");
    expect(matrix.requiredBuckets).toContain("security");
    expect(matrix.requiredBuckets).toContain("codex_default_discovery");
  });

  it("adds follow-up buckets from codex_default_discovery", () => {
    const matrix = buildSourceCoverageMatrix("research current agent framework choices", { routerOutput: broadResearchRouterOutput });
    const expanded = applyDefaultDiscoveryFindings(matrix, ["vendor_forum"]);
    expect(expanded.requiredBuckets).toContain("vendor_forum");
    expect(expanded.entries.find((entry) => entry.bucket === "vendor_forum")?.searchedAtLeastOnce).toBe(false);
  });

  it("defaults generic research to exhaustive required buckets", () => {
    const matrix = buildSourceCoverageMatrix("research current onboarding patterns for product teams", { routerOutput: broadResearchRouterOutput });
    expect(matrix.coverageMode).toBe("exhaustive");
    expect(matrix.requiredBuckets).toContain("official_docs");
    expect(matrix.requiredBuckets).toContain("github");
    expect(matrix.requiredBuckets).toContain("community");
    expect(matrix.requiredBuckets).toContain("academic");
    expect(matrix.requiredBuckets).toContain("package_registry");
    expect(matrix.requiredBuckets).toContain("security");
    expect(matrix.requiredBuckets).toContain("blogs_engineering");
    expect(matrix.requiredBuckets).toContain("codex_default_discovery");
    expect(matrix.entries.every((entry) => entry.required)).toBe(true);
  });

  it("upgrades broad buckets for AI agent security and evaluation tasks", () => {
    const matrix = buildSourceCoverageMatrix("research AI coding agent hidden validation sandbox evaluation framework choices", { routerOutput: agentSecurityRouterOutput });
    expect(matrix.requiredBuckets).toEqual(
      expect.arrayContaining(["official_docs", "github", "community", "academic", "package_registry", "security", "blogs_engineering", "codex_default_discovery"])
    );
  });

  it("requires local_repo and competitors for current-project comparison prompts", () => {
    const matrix = buildSourceCoverageMatrix("我现在这个项目做的multi agent结构有什么类似的产品或者项目？有哪些我可以吸收改进的？", {
      routerOutput: currentProjectCompetitorRouterOutput
    });
    expect(matrix.requiredBuckets).toContain("local_repo");
    expect(matrix.requiredBuckets).toContain("competitors");
  });

  it("preserves raw Chinese prompt classification when normalized task is English", () => {
    const rawUserPrompt = "我现在这个项目做的multi agent结构有什么类似的产品或者项目？有哪些我可以吸收改进的？";
    const report = buildResearchReport("Find comparable multi-agent research projects", [], "not_configured", {
      rawUserPrompt,
      normalizedTask: "Find comparable multi-agent research projects",
      routerOutput: currentProjectCompetitorRouterOutput
    });
    expect(report.promptHash).not.toBe(report.normalizedTask);
    expect(report.rawUserPrompt).toBe(rawUserPrompt);
    expect(report.source_matrix.task).toBe(rawUserPrompt);
    expect(report.source_matrix.requiredBuckets).toContain("local_repo");
    expect(report.source_matrix.requiredBuckets).toContain("competitors");
  });

  it("records codex_default_researcher timeout status in research reports", () => {
    const report = buildResearchReport("research current agent framework choices", [], "timeout", { routerOutput: broadResearchRouterOutput });
    expect(report.codex_default_discovery_status).toBe("timeout");
  });

  it("does not use keyword fallback when routerOutput is missing", () => {
    const matrix = buildSourceCoverageMatrix("research current AI agent framework choices");
    expect(matrix.routerStatus).toBe("unavailable");
    expect(matrix.requiredBuckets).toEqual([]);
  });
});
