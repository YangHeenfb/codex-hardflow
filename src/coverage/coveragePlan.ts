import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { researchRunCoveragePlanPath } from "../paths.js";
import type { RouterOutput } from "../router/routerSchema.js";
import { searchEngineNamesForBucket, searchEnginesForBucket } from "./searchEngineRegistry.js";

export type CoveragePriority = "critical" | "normal" | "optional";

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
  rawUserPrompt: string;
  normalizedTask: string;
  route: string;
  researchProfile: string;
  sourceBuckets: CoveragePlanSourceBucket[];
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

function uniqueBuckets(routerOutput: RouterOutput): Map<string, CoveragePlanSourceBucket> {
  const buckets = new Map<string, CoveragePlanSourceBucket>();
  for (const item of routerOutput.sourceBuckets) {
    const required = item.status === "required";
    buckets.set(item.bucket, {
      bucket: item.bucket,
      required,
      reason: item.reason,
      priority: required ? "normal" : "optional",
      expectedEngines: searchEngineNamesForBucket(item.bucket)
    });
  }
  return buckets;
}

function ensureBucket(
  buckets: Map<string, CoveragePlanSourceBucket>,
  bucket: string,
  defaults: Pick<CoveragePlanSourceBucket, "required" | "priority" | "reason">
): void {
  const existing = buckets.get(bucket);
  if (existing) {
    buckets.set(bucket, {
      ...existing,
      required: existing.required || defaults.required,
      priority: defaults.priority === "critical" ? "critical" : existing.priority,
      reason: existing.reason || defaults.reason,
      expectedEngines: existing.expectedEngines.length > 0 ? existing.expectedEngines : searchEngineNamesForBucket(bucket)
    });
    return;
  }
  buckets.set(bucket, {
    bucket,
    required: defaults.required,
    reason: defaults.reason,
    priority: defaults.priority,
    expectedEngines: searchEngineNamesForBucket(bucket)
  });
}

function applyProfileDefaults(routerOutput: RouterOutput, buckets: Map<string, CoveragePlanSourceBucket>): void {
  if (routerOutput.researchProfile === "broad" || routerOutput.researchProfile === "current_state" || routerOutput.researchProfile === "competitor") {
    ensureBucket(buckets, "codex_default_discovery", {
      required: true,
      priority: "critical",
      reason: "Broad research requires default discovery to catch missed buckets."
    });
  }
  if (routerOutput.researchProfile === "local_repo_plus_external") {
    ensureBucket(buckets, "local_repo", {
      required: true,
      priority: "critical",
      reason: "local_repo_plus_external requires current repository evidence."
    });
    ensureBucket(buckets, "competitors", {
      required: true,
      priority: "critical",
      reason: "local_repo_plus_external requires comparable project or product evidence."
    });
    ensureBucket(buckets, "official_docs", {
      required: false,
      priority: "normal",
      reason: "Official documentation can ground external comparisons."
    });
    ensureBucket(buckets, "github", {
      required: false,
      priority: "normal",
      reason: "GitHub evidence can ground implementation comparisons."
    });
    ensureBucket(buckets, "codex_default_discovery", {
      required: false,
      priority: "normal",
      reason: "Default discovery can catch adjacent projects missed by fixed buckets."
    });
  }
}

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
  const buckets = uniqueBuckets(routerOutput);
  applyProfileDefaults(routerOutput, buckets);
  const sourceBuckets = [...buckets.values()];
  const perspectives = options.perspectives && options.perspectives.length > 0 ? options.perspectives : defaultPerspectives(sourceBuckets);
  const researchQuestions =
    options.researchQuestions && options.researchQuestions.length > 0 ? options.researchQuestions : defaultResearchQuestions(rawUserPrompt, sourceBuckets);

  return {
    runId: options.runId,
    rawUserPrompt,
    normalizedTask: options.normalizedTask ?? rawUserPrompt,
    route: routerOutput.route,
    researchProfile: routerOutput.researchProfile,
    sourceBuckets,
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
