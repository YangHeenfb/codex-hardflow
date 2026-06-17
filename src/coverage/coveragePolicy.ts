import { safetyHeuristics } from "../classify.js";
import type { RouterOutput } from "../router/routerSchema.js";
import type { BucketPriority, CoverageMode, ExcludedBucket, SourceBucket, TaskClassification } from "../schemas.js";

export interface CoverageBucketDecision {
  bucket: string;
  required: boolean;
  status: "required" | "possible" | "excluded";
  reason: string;
  priority: BucketPriority;
}

export interface CoveragePolicyResult {
  coverageMode?: CoverageMode;
  buckets: CoverageBucketDecision[];
  excludedBuckets: ExcludedBucket[];
  skippedPossibleBuckets: string[];
  coverageDebt: string[];
  searchedButNoSignalRequired: boolean;
}

const EXHAUSTIVE_BASE_BUCKETS: SourceBucket[] = [
  "official_docs",
  "github",
  "community",
  "academic",
  "package_registry",
  "security",
  "blogs_engineering",
  "codex_default_discovery"
];

const ROUTER_RESEARCH_PROFILES = new Set(["light", "broad", "current_state", "competitor", "local_repo_plus_external"]);

function isResearchLike(routerOutput: RouterOutput, classification: TaskClassification): boolean {
  return (
    routerOutput.route === "research" ||
    routerOutput.requiresSourceMatrix ||
    ROUTER_RESEARCH_PROFILES.has(routerOutput.researchProfile) ||
    classification.researchHeavy ||
    classification.currentState ||
    classification.solutionFinding ||
    classification.troubleshooting ||
    classification.architectureChoice ||
    classification.frameworkChoice ||
    classification.agentRelevant
  );
}

export function resolveCoverageMode(routerOutput: RouterOutput, task: string, explicitMode?: CoverageMode): CoverageMode | undefined {
  if (explicitMode) return explicitMode;
  if (routerOutput.researchScope === "none" || routerOutput.evidenceNeed === "none") return undefined;
  if (routerOutput.exhaustiveCoverageRequired || routerOutput.route === "research" || routerOutput.requiresSourceMatrix) return "exhaustive";
  const classification = safetyHeuristics(task);
  if (!isResearchLike(routerOutput, classification)) return undefined;
  return "exhaustive";
}

function priorityForBucket(bucket: string, classification: TaskClassification): BucketPriority {
  if (bucket === "official_docs" || bucket === "codex_default_discovery" || bucket === "local_repo") return "critical";
  if (bucket === "github") return classification.agentRelevant || classification.frameworkChoice || classification.implementation ? "critical" : "normal";
  if (bucket === "competitors") return classification.competitorRelevant ? "critical" : "normal";
  if (bucket === "security") return classification.securityRelevant || classification.validationSensitive ? "critical" : "normal";
  if (bucket === "academic") return classification.agentRelevant || classification.evaluationRelevant ? "normal" : "low";
  if (bucket === "package_registry") return classification.packageRelevant || classification.frameworkChoice ? "normal" : "low";
  if (bucket === "community" || bucket === "blogs_engineering") return "low";
  return "normal";
}

function upsertBucket(
  buckets: Map<string, CoverageBucketDecision>,
  bucket: string,
  input: Pick<CoverageBucketDecision, "required" | "status" | "reason"> & { priority?: BucketPriority },
  classification: TaskClassification
): void {
  const nextPriority = input.priority ?? priorityForBucket(bucket, classification);
  const existing = buckets.get(bucket);
  if (!existing) {
    buckets.set(bucket, {
      bucket,
      required: input.required,
      status: input.status,
      reason: input.reason,
      priority: nextPriority
    });
    return;
  }
  const priority: BucketPriority = existing.priority === "critical" || nextPriority === "critical" ? "critical" : existing.priority === "normal" || nextPriority === "normal" ? "normal" : "low";
  buckets.set(bucket, {
    ...existing,
    required: existing.required || input.required,
    status: existing.required || input.required ? "required" : existing.status,
    reason: existing.reason || input.reason,
    priority
  });
}

function excludeBucket(excluded: Map<string, ExcludedBucket>, bucket: string, reason: string): void {
  if (!excluded.has(bucket)) excluded.set(bucket, { bucket, reason });
}

function routerReason(routerOutput: RouterOutput, bucket: string): string | undefined {
  return routerOutput.sourceBuckets.find((item) => item.bucket === bucket)?.reason;
}

function routerBucketStatus(routerOutput: RouterOutput, bucket: string): "required" | "possible" | "not_needed" | undefined {
  return routerOutput.sourceBuckets.find((item) => item.bucket === bucket)?.status;
}

function routerHasApplicableBucket(routerOutput: RouterOutput, bucket: string): boolean {
  const status = routerBucketStatus(routerOutput, bucket);
  return status === "required" || status === "possible";
}

function applyRouterBuckets(routerOutput: RouterOutput, mode: CoverageMode | undefined, classification: TaskClassification, buckets: Map<string, CoverageBucketDecision>, excluded: Map<string, ExcludedBucket>): void {
  for (const item of routerOutput.sourceBuckets) {
    if (item.status === "not_needed") {
      excludeBucket(excluded, item.bucket, item.reason || "Router marked this bucket as logically not needed.");
      continue;
    }
    if (item.bucket === "private_connectors" && !classification.privateConnectorsExplicit) {
      excludeBucket(excluded, item.bucket, "Private connectors require explicit private/internal context from the user.");
      continue;
    }
    const exhaustive = mode === "exhaustive";
    const required = exhaustive || item.status === "required";
    upsertBucket(
      buckets,
      item.bucket,
      {
        required,
        status: required ? "required" : "possible",
        reason: exhaustive && item.status === "possible" ? `${item.reason} Upgraded to required by exhaustive coverage mode.` : item.reason,
        priority: item.status === "possible" && !exhaustive ? "low" : undefined
      },
      classification
    );
  }
}

function requireBucket(
  routerOutput: RouterOutput,
  classification: TaskClassification,
  buckets: Map<string, CoverageBucketDecision>,
  bucket: string,
  reason: string,
  priority?: BucketPriority
): void {
  const sourceReason = routerReason(routerOutput, bucket);
  const status = routerBucketStatus(routerOutput, bucket);
  const resolvedReason = sourceReason
    ? status === "possible"
      ? `${sourceReason} Upgraded to required by exhaustive coverage mode.`
      : sourceReason
    : reason;
  upsertBucket(
    buckets,
    bucket,
    {
      required: true,
      status: "required",
      reason: resolvedReason,
      priority
    },
    classification
  );
}

function requireExternalBase(routerOutput: RouterOutput, classification: TaskClassification, buckets: Map<string, CoverageBucketDecision>): void {
  for (const bucket of EXHAUSTIVE_BASE_BUCKETS) {
    requireBucket(routerOutput, classification, buckets, bucket, "Exhaustive external coverage requires this bucket because it has a non-trivial chance of useful research signal.");
  }
}

function requireLocalPlusBase(routerOutput: RouterOutput, classification: TaskClassification, buckets: Map<string, CoverageBucketDecision>): void {
  requireBucket(routerOutput, classification, buckets, "local_repo", "Local plus external coverage requires local repository diagnosis.", "critical");
  for (const bucket of ["official_docs", "github", "blogs_engineering", "codex_default_discovery"]) {
    requireBucket(routerOutput, classification, buckets, bucket, "Local plus external coverage requires this external bucket for solution grounding.");
  }
}

function requireRouterApplicableBuckets(routerOutput: RouterOutput, classification: TaskClassification, buckets: Map<string, CoverageBucketDecision>, excluded: Map<string, ExcludedBucket>): void {
  for (const item of routerOutput.sourceBuckets) {
    if (item.status === "not_needed") {
      excludeBucket(excluded, item.bucket, item.reason || "Router marked this bucket as logically not needed.");
      continue;
    }
    requireBucket(routerOutput, classification, buckets, item.bucket, `${item.bucket} was selected by RouterOutput sourceBuckets.`);
  }
}

function applyExhaustiveDefaults(task: string, routerOutput: RouterOutput, classification: TaskClassification, buckets: Map<string, CoverageBucketDecision>, excluded: Map<string, ExcludedBucket>): void {
  const scope = routerOutput.researchScope;
  for (const item of routerOutput.sourceBuckets) {
    if (item.status === "not_needed") excludeBucket(excluded, item.bucket, item.reason || "Router marked this bucket as logically not needed.");
  }

  if (scope === "none") {
    void task;
    return;
  }

  if (scope === "local_diagnostic") {
    requireBucket(routerOutput, classification, buckets, "local_repo", "Local diagnostic scope requires current repository evidence.", "critical");
    if (routerOutput.externalResearchRequired || routerOutput.evidenceNeed === "external_sources_required") {
      requireLocalPlusBase(routerOutput, classification, buckets);
      requireRouterApplicableBuckets(routerOutput, classification, buckets, excluded);
    }
  } else if (scope === "local_plus_external") {
    requireLocalPlusBase(routerOutput, classification, buckets);
    for (const bucket of ["security", "package_registry", "academic", "community", "competitors"]) {
      if (routerHasApplicableBucket(routerOutput, bucket)) requireBucket(routerOutput, classification, buckets, bucket, `${bucket} was selected by RouterOutput for local plus external coverage.`);
    }
    if (routerBucketStatus(routerOutput, "private_connectors") === "required") {
      requireBucket(routerOutput, classification, buckets, "private_connectors", "Router requested private/internal connector evidence.");
    }
  } else if (scope === "external_exhaustive") {
    requireExternalBase(routerOutput, classification, buckets);
    if (routerHasApplicableBucket(routerOutput, "competitors") || routerOutput.researchProfile === "competitor") {
      requireBucket(routerOutput, classification, buckets, "competitors", "Router requested competitors, alternatives, or comparison evidence.", "critical");
    }
    if (routerHasApplicableBucket(routerOutput, "local_repo") || routerOutput.researchProfile === "local_repo_plus_external") {
      requireBucket(routerOutput, classification, buckets, "local_repo", "Router requested current repository context alongside external research.", "critical");
    }
    if (routerBucketStatus(routerOutput, "private_connectors") === "required") {
      requireBucket(routerOutput, classification, buckets, "private_connectors", "Router requested private/internal connector evidence.");
    }
  } else if (scope === "implementation_support") {
    upsertBucket(
      buckets,
      "local_repo",
      {
        required: true,
        status: "required",
        reason: routerReason(routerOutput, "local_repo") ?? "Implementation support starts from current repository evidence.",
        priority: "critical"
      },
      classification
    );
    if (routerOutput.externalResearchRequired || routerOutput.evidenceNeed === "external_sources_required") {
      requireLocalPlusBase(routerOutput, classification, buckets);
      requireRouterApplicableBuckets(routerOutput, classification, buckets, excluded);
    }
  }

  if (routerBucketStatus(routerOutput, "private_connectors") !== "required") excludeBucket(excluded, "private_connectors", "Private/internal connectors require explicit private/internal context from RouterOutput.");
  void task;
}

function applyBalancedProfileDefaults(routerOutput: RouterOutput, classification: TaskClassification, buckets: Map<string, CoverageBucketDecision>): void {
  if (routerOutput.researchProfile === "broad" || routerOutput.researchProfile === "current_state" || routerOutput.researchProfile === "competitor") {
    upsertBucket(
      buckets,
      "codex_default_discovery",
      {
        required: true,
        status: "required",
        reason: "Broad research requires default discovery to catch missed buckets.",
        priority: "critical"
      },
      classification
    );
  }
  if (routerOutput.researchProfile === "local_repo_plus_external") {
    upsertBucket(buckets, "local_repo", { required: true, status: "required", reason: "local_repo_plus_external requires current repository evidence.", priority: "critical" }, classification);
    upsertBucket(buckets, "competitors", { required: true, status: "required", reason: "local_repo_plus_external requires comparable project or product evidence.", priority: "critical" }, classification);
  }
}

export function expandCoveragePolicy(routerOutput: RouterOutput, task: string, explicitMode?: CoverageMode): CoveragePolicyResult {
  const classification = safetyHeuristics(task);
  const coverageMode = resolveCoverageMode(routerOutput, task, explicitMode);
  const buckets = new Map<string, CoverageBucketDecision>();
  const excluded = new Map<string, ExcludedBucket>();
  if (coverageMode === "exhaustive") applyExhaustiveDefaults(task, routerOutput, classification, buckets, excluded);
  else {
    applyRouterBuckets(routerOutput, coverageMode, classification, buckets, excluded);
    applyBalancedProfileDefaults(routerOutput, classification, buckets);
  }

  const activeBuckets = [...buckets.values()].filter((bucket) => !excluded.has(bucket.bucket));
  const skippedPossibleBuckets = coverageMode === "exhaustive" ? [] : activeBuckets.filter((bucket) => !bucket.required).map((bucket) => bucket.bucket);
  const coverageDebt = skippedPossibleBuckets.map((bucket) => `${bucket}: possible bucket not required in ${coverageMode ?? "no"} coverage mode.`);

  return {
    coverageMode,
    buckets: activeBuckets,
    excludedBuckets: [...excluded.values()],
    skippedPossibleBuckets,
    coverageDebt,
    searchedButNoSignalRequired: coverageMode === "exhaustive"
  };
}
