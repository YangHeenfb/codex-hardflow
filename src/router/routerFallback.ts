import type { RouterOutput } from "./routerSchema.js";

export function routerFailedOutput(reason = "Router unavailable or invalid; no keyword fallback used."): RouterOutput {
  return {
    route: "router_failed",
    workflowPattern: "direct",
    researchProfile: "none",
    researchScope: "none",
    evidenceNeed: "none",
    localDiagnosisRequired: false,
    externalResearchRequired: false,
    exhaustiveCoverageRequired: false,
    validationProfile: "none",
    sourceBuckets: [],
    requiredAgents: [],
    requiresSourceMatrix: false,
    requiresExecutorManifest: false,
    requiresValidation: false,
    requiresFinalHoldout: false,
    requiresParallelIsolation: false,
    reasons: [reason],
    risks: ["ambiguous_task"],
    bypass: {
      requested: false,
      reason: ""
    }
  };
}
