import type { RouterOutput } from "../src/router/routerSchema.js";

export function routerOutputForBuckets(buckets: string[], overrides: Partial<RouterOutput> = {}): RouterOutput {
  const route = overrides.route ?? "research";
  const researchProfile = overrides.researchProfile ?? "broad";
  const researchScope =
    overrides.researchScope ??
    (route === "direct_answer" || route === "bypass" || route === "clarify" || route === "router_failed"
      ? "none"
      : route === "implementation" || route === "validation_sensitive_implementation" || route === "parallel_modules"
        ? "implementation_support"
        : researchProfile === "local_repo_plus_external"
          ? "local_plus_external"
          : "external_exhaustive");
  const evidenceNeed =
    overrides.evidenceNeed ??
    (researchScope === "none" ? "none" : researchScope === "local_diagnostic" ? "local_only" : researchScope === "implementation_support" ? "external_sources_optional" : "external_sources_required");
  return {
    route,
    workflowPattern: "parallel_research",
    researchProfile,
    researchScope,
    evidenceNeed,
    localDiagnosisRequired: overrides.localDiagnosisRequired ?? (researchScope === "local_diagnostic" || researchScope === "local_plus_external" || researchScope === "implementation_support"),
    externalResearchRequired: overrides.externalResearchRequired ?? (evidenceNeed === "external_sources_required" || researchScope === "external_exhaustive"),
    exhaustiveCoverageRequired: overrides.exhaustiveCoverageRequired ?? (researchScope === "external_exhaustive" || researchScope === "local_plus_external"),
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
    ...overrides,
    route,
    researchProfile,
    researchScope,
    evidenceNeed
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
  researchProfile: "local_repo_plus_external",
  researchScope: "local_plus_external",
  evidenceNeed: "external_sources_required",
  localDiagnosisRequired: true,
  externalResearchRequired: true,
  exhaustiveCoverageRequired: true
});
