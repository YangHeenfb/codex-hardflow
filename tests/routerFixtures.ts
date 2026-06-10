import type { RouterOutput } from "../src/router/routerSchema.js";

export function routerOutputForBuckets(buckets: string[], overrides: Partial<RouterOutput> = {}): RouterOutput {
  return {
    route: "research",
    workflowPattern: "parallel_research",
    researchProfile: "broad",
    validationProfile: "none",
    sourceBuckets: buckets.map((bucket) => ({
      bucket: bucket as RouterOutput["sourceBuckets"][number]["bucket"],
      status: "required",
      reason: `${bucket} required by router fixture.`
    })),
    requiredAgents: buckets.map((bucket) => ({
      name: bucket === "codex_default_discovery" ? "codex_default_researcher" : `${bucket}_researcher`,
      required: true,
      reason: `${bucket} agent required by router fixture.`
    })),
    requiresSourceMatrix: true,
    requiresExecutorManifest: false,
    requiresValidation: false,
    requiresFinalHoldout: false,
    requiresParallelIsolation: false,
    reasons: ["Router fixture selected research."],
    risks: ["may_need_current_info"],
    bypass: {
      requested: false,
      reason: ""
    },
    ...overrides
  };
}

export const broadResearchRouterOutput = routerOutputForBuckets(["official_docs", "github", "community", "codex_default_discovery"]);

export const agentSecurityRouterOutput = routerOutputForBuckets([
  "official_docs",
  "github",
  "community",
  "academic",
  "package_registry",
  "security",
  "blogs_engineering",
  "codex_default_discovery"
]);

export const currentProjectCompetitorRouterOutput = routerOutputForBuckets(["local_repo", "competitors", "official_docs", "github", "community", "codex_default_discovery"], {
  researchProfile: "local_repo_plus_external"
});
