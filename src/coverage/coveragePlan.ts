import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { researchRunCoveragePlanPath } from "../paths.js";
import type { RouterOutput } from "../router/routerSchema.js";
import type { BucketPriority, CoverageMode, ExcludedBucket } from "../schemas.js";
import { expandCoveragePolicy } from "./coveragePolicy.js";
import { searchEngineNamesForBucket, searchEnginesForBucket } from "./searchEngineRegistry.js";

export type CoveragePriority = BucketPriority;

export interface CoveragePlanSourceBucket {
  bucket: string;
  required: boolean;
  reason: string;
  priority: CoveragePriority;
  expectedEngines: string[];
}

export interface CoveragePerspective {
  id: string;
  label: string;
  reason: string;
  required: boolean;
}

export interface CoverageResearchQuestion {
  id: string;
  question: string;
  bucket: string;
  perspectiveId: string | null;
  priority: CoveragePriority;
}

export interface CoveragePlanSearchEngine {
  engine: string;
  bucket: string;
  enabled: boolean;
  reason: string;
}

export interface CoveragePlan {
  runId: string;
  coverageMode?: CoverageMode;
  rawUserPrompt: string;
  normalizedTask: string;
  route: string;
  researchProfile: string;
  sourceBuckets: CoveragePlanSourceBucket[];
  requiredBuckets: string[];
  excludedBuckets: ExcludedBucket[];
  searchedButNoSignalRequired: boolean;
  requiredBucketCount: number;
  skippedPossibleBuckets: string[];
  coverageDebt: string[];
  perspectives: CoveragePerspective[];
  researchQuestions: CoverageResearchQuestion[];
  searchEngines: CoveragePlanSearchEngine[];
  budget: {
    breadth: number;
    depth: number;
    maxRounds: number;
    maxSources: number;
  };
  gates: {
    requireNoSignalRecords: boolean;
    requireEvidenceLedger: boolean;
    requireClaimAnchors: boolean;
    requireCoverageAudit: boolean;
  };
}

export interface BuildCoveragePlanOptions {
  runId: string;
  normalizedTask?: string;
  coverageMode?: CoverageMode;
  perspectives?: CoveragePerspective[];
  researchQuestions?: CoverageResearchQuestion[];
}

const DEFAULT_PERSPECTIVES: Record<string, Omit<CoveragePerspective, "id">> = {
  primary_answer: {
    label: "Primary task answer",
    reason: "Default perspective for answering the routed task.",
    required: true
  },
  local_context: {
    label: "Current repository context",
    reason: "Router requested local repository evidence.",
    required: true
  },
  comparative: {
    label: "Comparable projects or products",
    reason: "Router requested competitor or adjacent-project evidence.",
    required: true
  },
  risk: {
    label: "Risk, security, and operational constraints",
    reason: "Router requested security or production-risk evidence.",
    required: true
  },
  scholarly: {
    label: "Research and evaluation grounding",
    reason: "Router requested academic or evaluation evidence.",
    required: false
  }
};

function perspectiveIdForBucket(bucket: string): string {
  if (bucket === "local_repo") return "local_context";
  if (bucket === "competitors") return "comparative";
  if (bucket === "security" || bucket === "package_registry") return "risk";
  if (bucket === "academic") return "scholarly";
  return "primary_answer";
}

function defaultPerspectives(buckets: CoveragePlanSourceBucket[]): CoveragePerspective[] {
  const ids = new Set<string>(["primary_answer"]);
  for (const bucket of buckets) ids.add(perspectiveIdForBucket(bucket.bucket));
  return [...ids].map((id) => ({ id, ...DEFAULT_PERSPECTIVES[id] })).filter((item): item is CoveragePerspective => Boolean(item.label));
}

function defaultResearchQuestions(rawUserPrompt: string, buckets: CoveragePlanSourceBucket[]): CoverageResearchQuestion[] {
  return buckets.map((bucket, index) => ({
    id: `q_${index + 1}_${bucket.bucket}`,
    question: `What reliable evidence from ${bucket.bucket} answers: ${rawUserPrompt}`,
    bucket: bucket.bucket,
    perspectiveId: perspectiveIdForBucket(bucket.bucket),
    priority: bucket.priority
  }));
}

function searchEnginesForBuckets(buckets: CoveragePlanSourceBucket[]): CoveragePlanSearchEngine[] {
  return buckets.flatMap((bucket) =>
    searchEnginesForBucket(bucket.bucket).map((engine) => ({
      engine: engine.name,
      bucket: bucket.bucket,
      enabled: engine.available,
      reason: engine.available ? `Registered engine for ${bucket.bucket}.` : `Registered engine for ${bucket.bucket}, but unavailable in this runtime.`
    }))
  );
}

function budgetFor(routerOutput: RouterOutput, bucketCount: number): CoveragePlan["budget"] {
  if (bucketCount >= 8) {
    return { breadth: Math.max(8, bucketCount), depth: 2, maxRounds: 2, maxSources: Math.max(24, bucketCount * 3) };
  }
  if (routerOutput.researchProfile === "light") {
    return { breadth: Math.max(3, bucketCount), depth: 1, maxRounds: 1, maxSources: 8 };
  }
  if (routerOutput.researchProfile === "local_repo_plus_external") {
    return { breadth: Math.max(5, bucketCount), depth: 2, maxRounds: 2, maxSources: 18 };
  }
  if (routerOutput.researchProfile === "broad" || routerOutput.researchProfile === "current_state" || routerOutput.researchProfile === "competitor") {
    return { breadth: Math.max(5, bucketCount), depth: 2, maxRounds: 2, maxSources: 24 };
  }
  return { breadth: Math.max(1, bucketCount), depth: 1, maxRounds: 1, maxSources: Math.max(4, bucketCount * 2) };
}

function gatesFor(routerOutput: RouterOutput): CoveragePlan["gates"] {
  const broad = routerOutput.researchProfile === "broad" || routerOutput.researchProfile === "current_state" || routerOutput.researchProfile === "competitor";
  const research = routerOutput.route === "research";
  return {
    requireNoSignalRecords: broad,
    requireEvidenceLedger: broad || research,
    requireClaimAnchors: broad || routerOutput.requiresValidation,
    requireCoverageAudit: research || routerOutput.requiresSourceMatrix
  };
}

export function buildCoveragePlan(routerOutput: RouterOutput, rawUserPrompt: string, options: BuildCoveragePlanOptions): CoveragePlan {
  const policy = expandCoveragePolicy(routerOutput, rawUserPrompt, options.coverageMode);
  const sourceBuckets = policy.buckets.map((bucket) => ({
    bucket: bucket.bucket,
    required: bucket.required,
    reason: bucket.reason,
    priority: bucket.priority,
    expectedEngines: searchEngineNamesForBucket(bucket.bucket)
  }));
  const requiredBuckets = sourceBuckets.filter((bucket) => bucket.required).map((bucket) => bucket.bucket);
  const perspectives = options.perspectives && options.perspectives.length > 0 ? options.perspectives : defaultPerspectives(sourceBuckets);
  const researchQuestions =
    options.researchQuestions && options.researchQuestions.length > 0 ? options.researchQuestions : defaultResearchQuestions(rawUserPrompt, sourceBuckets);

  return {
    runId: options.runId,
    coverageMode: policy.coverageMode,
    rawUserPrompt,
    normalizedTask: options.normalizedTask ?? rawUserPrompt,
    route: routerOutput.route,
    researchProfile: routerOutput.researchProfile,
    sourceBuckets,
    requiredBuckets,
    excludedBuckets: policy.excludedBuckets,
    searchedButNoSignalRequired: policy.searchedButNoSignalRequired,
    requiredBucketCount: requiredBuckets.length,
    skippedPossibleBuckets: policy.skippedPossibleBuckets,
    coverageDebt: policy.coverageDebt,
    perspectives,
    researchQuestions,
    searchEngines: searchEnginesForBuckets(sourceBuckets),
    budget: budgetFor(routerOutput, sourceBuckets.length),
    gates: gatesFor(routerOutput)
  };
}

export function writeCoveragePlan(cwd: string, plan: CoveragePlan): CoveragePlan {
  const target = researchRunCoveragePlanPath(cwd, plan.runId);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

export function loadCoveragePlan(cwd: string, runId: string): CoveragePlan {
  const target = researchRunCoveragePlanPath(cwd, runId);
  if (!existsSync(target)) throw new Error(`coverage_plan.json is missing for runId=${runId}.`);
  return JSON.parse(readFileSync(target, "utf8")) as CoveragePlan;
}

export function maybeLoadCoveragePlan(cwd: string, runId: string): CoveragePlan | undefined {
  const target = researchRunCoveragePlanPath(cwd, runId);
  if (!existsSync(target)) return undefined;
  return JSON.parse(readFileSync(target, "utf8")) as CoveragePlan;
}
