import { describe, expect, it } from "vitest";
import { triggerPolicyForRouterOutput } from "../src/triggerPolicy.js";
import { currentProjectCompetitorRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";

describe("TriggerPolicy", () => {
  it("routes direct_answer without research execution", () => {
    const decision = triggerPolicyForRouterOutput(
      routerOutputForBuckets([], {
        route: "direct_answer",
        workflowPattern: "direct",
        researchProfile: "none",
        requiresSourceMatrix: false,
        reasons: ["translation only"],
        risks: []
      })
    );

    expect(decision.action).toBe("direct_answer");
    expect(decision.shouldCreateResearchRun).toBe(false);
    expect(decision.coverageMode).toBeUndefined();
    expect(decision.parallelPolicy).toBeUndefined();
  });

  it("routes research to strict exhaustive all_required programmatic research", () => {
    const decision = triggerPolicyForRouterOutput(currentProjectCompetitorRouterOutput);

    expect(decision.action).toBe("strict_programmatic_research");
    expect(decision.shouldCreateResearchRun).toBe(true);
    expect(decision.runnerMode).toBe("strict_programmatic");
    expect(decision.coverageMode).toBe("exhaustive");
    expect(decision.parallelPolicy).toBe("all_required");
  });

  it("does not force external research for implementation unless router requires source matrix", () => {
    const directImplementation = triggerPolicyForRouterOutput(
      routerOutputForBuckets([], {
        route: "implementation",
        workflowPattern: "sequential_pipeline",
        researchProfile: "none",
        requiresSourceMatrix: false,
        requiresExecutorManifest: true
      })
    );
    const docsNeeded = triggerPolicyForRouterOutput(
      routerOutputForBuckets(["official_docs", "github"], {
        route: "implementation",
        workflowPattern: "sequential_pipeline",
        requiresSourceMatrix: true,
        requiresExecutorManifest: true
      })
    );

    expect(directImplementation.shouldCreateResearchRun).toBe(false);
    expect(directImplementation.requireExecutorManifest).toBe(true);
    expect(docsNeeded.shouldCreateResearchRun).toBe(true);
    expect(docsNeeded.parallelPolicy).toBe("all_required");
  });
});
