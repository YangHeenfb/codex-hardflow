import type { RouterOutput } from "./router/routerSchema.js";
import type { CoverageMode, ParallelPolicy, ResearchRunnerMode } from "./schemas.js";

export type TriggerAction =
  | "none"
  | "direct_answer"
  | "strict_programmatic_research"
  | "implementation"
  | "validation_sensitive_implementation"
  | "parallel_modules"
  | "clarify"
  | "bypass"
  | "router_failed";

export interface TriggerPolicyDecision {
  action: TriggerAction;
  shouldCreateResearchRun: boolean;
  runnerMode?: ResearchRunnerMode;
  coverageMode?: CoverageMode;
  parallelPolicy?: ParallelPolicy;
  requireExecutorManifest: boolean;
  requireValidation: boolean;
  requireFinalHoldout: boolean;
  reason: string;
}

export function triggerPolicyForRouterOutput(routerOutput: RouterOutput): TriggerPolicyDecision {
  if (routerOutput.route === "direct_answer") {
    return {
      action: "direct_answer",
      shouldCreateResearchRun: false,
      requireExecutorManifest: false,
      requireValidation: false,
      requireFinalHoldout: false,
      reason: "Router selected direct_answer; hardflow research is not triggered."
    };
  }
  if (routerOutput.route === "research") {
    return {
      action: "strict_programmatic_research",
      shouldCreateResearchRun: true,
      runnerMode: "strict_programmatic",
      coverageMode: "exhaustive",
      parallelPolicy: "all_required",
      requireExecutorManifest: false,
      requireValidation: false,
      requireFinalHoldout: false,
      reason: "Router selected research; strict programmatic exhaustive research is required."
    };
  }
  if (routerOutput.route === "implementation") {
    return {
      action: "implementation",
      shouldCreateResearchRun: routerOutput.requiresSourceMatrix,
      runnerMode: routerOutput.requiresSourceMatrix ? "strict_programmatic" : undefined,
      coverageMode: routerOutput.requiresSourceMatrix ? "exhaustive" : undefined,
      parallelPolicy: routerOutput.requiresSourceMatrix ? "all_required" : undefined,
      requireExecutorManifest: routerOutput.requiresExecutorManifest,
      requireValidation: routerOutput.requiresValidation,
      requireFinalHoldout: routerOutput.requiresFinalHoldout,
      reason: routerOutput.requiresSourceMatrix
        ? "Router selected implementation with external source needs; strict research must run before implementation completes."
        : "Router selected implementation; start from local repository evidence and create ResearchRequest if external facts become necessary."
    };
  }
  if (routerOutput.route === "validation_sensitive_implementation") {
    return {
      action: "validation_sensitive_implementation",
      shouldCreateResearchRun: routerOutput.requiresSourceMatrix,
      runnerMode: routerOutput.requiresSourceMatrix ? "strict_programmatic" : undefined,
      coverageMode: routerOutput.requiresSourceMatrix ? "exhaustive" : undefined,
      parallelPolicy: routerOutput.requiresSourceMatrix ? "all_required" : undefined,
      requireExecutorManifest: true,
      requireValidation: true,
      requireFinalHoldout: routerOutput.requiresFinalHoldout,
      reason: "Router selected validation-sensitive implementation; manifest and validation gates are required."
    };
  }
  if (routerOutput.route === "parallel_modules") {
    return {
      action: "parallel_modules",
      shouldCreateResearchRun: routerOutput.requiresSourceMatrix,
      runnerMode: routerOutput.requiresSourceMatrix ? "strict_programmatic" : undefined,
      coverageMode: routerOutput.requiresSourceMatrix ? "exhaustive" : undefined,
      parallelPolicy: routerOutput.requiresSourceMatrix ? "all_required" : undefined,
      requireExecutorManifest: routerOutput.requiresExecutorManifest,
      requireValidation: routerOutput.requiresValidation,
      requireFinalHoldout: routerOutput.requiresFinalHoldout,
      reason: "Router selected parallel modules; path_scope and shared contracts must be planned before workers run."
    };
  }
  if (routerOutput.route === "bypass" || routerOutput.bypass.requested) {
    return {
      action: "bypass",
      shouldCreateResearchRun: false,
      requireExecutorManifest: false,
      requireValidation: false,
      requireFinalHoldout: false,
      reason: routerOutput.bypass.reason || "Router selected bypass."
    };
  }
  if (routerOutput.route === "clarify") {
    return {
      action: "clarify",
      shouldCreateResearchRun: false,
      requireExecutorManifest: false,
      requireValidation: false,
      requireFinalHoldout: false,
      reason: "Router selected clarify; ask for missing information before running hardflow."
    };
  }
  return {
    action: "router_failed",
    shouldCreateResearchRun: false,
    requireExecutorManifest: false,
    requireValidation: false,
    requireFinalHoldout: false,
    reason: "Router failed; do not use keyword fallback or claim hardflow completion."
  };
}
