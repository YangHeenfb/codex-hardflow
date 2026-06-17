import {
  EVIDENCE_NEEDS,
  RESEARCH_SCOPES,
  ROUTER_SOURCE_BUCKETS,
  SOURCE_BUCKET_STATUSES,
  type RouterOutput,
  type RouterSourceBucket
} from "./routerSchema.js";

export interface RouterNormalizationResult {
  normalized: unknown;
  warnings: string[];
}

const validSourceBuckets = new Set<string>(ROUTER_SOURCE_BUCKETS);
const validSourceBucketStatuses = new Set<string>(SOURCE_BUCKET_STATUSES);
const validResearchScopes = new Set<string>(RESEARCH_SCOPES);
const validEvidenceNeeds = new Set<string>(EVIDENCE_NEEDS);
const sourceBucketStatusSynonyms: Record<string, RouterSourceBucket["status"]> = {
  optional: "possible",
  maybe: "possible",
  recommended: "required",
  must_search: "required",
  not_applicable: "not_needed",
  irrelevant: "not_needed",
  unavailable: "excluded",
  forbidden: "excluded",
  private_unavailable: "excluded",
  skipped_for_safety: "excluded"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSourceBucketStatus(status: unknown, bucket: string, warnings: string[]): RouterSourceBucket["status"] {
  if (typeof status !== "string" || status.length === 0) return "required";
  if (validSourceBucketStatuses.has(status)) return status as RouterSourceBucket["status"];
  const normalized = sourceBucketStatusSynonyms[status.toLowerCase()];
  if (normalized) return normalized;
  warnings.push(`invalid source bucket status "${status}" for bucket "${bucket}", defaulted to required.`);
  return "required";
}

function normalizeSourceBuckets(value: unknown, warnings: string[]): unknown[] {
  if (!Array.isArray(value)) return [];
  const buckets: unknown[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (!validSourceBuckets.has(item)) {
        warnings.push(`invalid source bucket: ${item}`);
        continue;
      }
      const bucket = item as RouterSourceBucket["bucket"];
      buckets.push({
        bucket,
        status: "required",
        reason: "Normalized from router string bucket."
      } satisfies RouterSourceBucket);
      continue;
    }
    if (!isRecord(item)) {
      warnings.push(`invalid source bucket: ${String(item)}`);
      continue;
    }
    const bucket = item.bucket;
    if (typeof bucket !== "string" || !validSourceBuckets.has(bucket)) {
      warnings.push(`invalid source bucket: ${String(bucket)}`);
      continue;
    }
    buckets.push({
      ...item,
      status: normalizeSourceBucketStatus(item.status, bucket, warnings),
      reason: typeof item.reason === "string" && item.reason.length > 0 ? item.reason : "Normalized from router bucket."
    });
  }
  return buckets;
}

function normalizeRequiredAgents(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") {
      return {
        name: item,
        required: true,
        reason: "Normalized from router string agent."
      };
    }
    if (!isRecord(item)) return item;
    return {
      ...item,
      required: item.required === undefined ? true : item.required,
      reason: typeof item.reason === "string" && item.reason.length > 0 ? item.reason : "Normalized from router agent."
    };
  });
}

function normalizeBypass(value: unknown): { requested: boolean; reason: string } | unknown {
  if (typeof value === "boolean") {
    return {
      requested: value,
      reason: value ? "Router returned boolean bypass=true." : "Router returned boolean bypass=false."
    };
  }
  if (value === undefined) {
    return {
      requested: false,
      reason: ""
    };
  }
  return value;
}

function defaultResearchScope(raw: Record<string, unknown>): RouterOutput["researchScope"] {
  const route = raw.route;
  if (route === "direct_answer" || route === "bypass" || route === "clarify" || route === "router_failed") return "none";
  if (route === "implementation" || route === "validation_sensitive_implementation" || route === "parallel_modules") return "implementation_support";
  if (route === "hardflow_maintenance") return "local_diagnostic";
  if (route === "research") {
    if (raw.researchProfile === "local_repo_plus_external") return "local_plus_external";
    return "external_exhaustive";
  }
  return "none";
}

function defaultEvidenceNeed(scope: RouterOutput["researchScope"]): RouterOutput["evidenceNeed"] {
  if (scope === "none") return "none";
  if (scope === "local_diagnostic") return "local_only";
  if (scope === "implementation_support") return "external_sources_optional";
  return "external_sources_required";
}

function normalizedResearchScope(raw: Record<string, unknown>): RouterOutput["researchScope"] {
  return typeof raw.researchScope === "string" && validResearchScopes.has(raw.researchScope) ? (raw.researchScope as RouterOutput["researchScope"]) : defaultResearchScope(raw);
}

function normalizedEvidenceNeed(raw: Record<string, unknown>, scope: RouterOutput["researchScope"]): RouterOutput["evidenceNeed"] {
  return typeof raw.evidenceNeed === "string" && validEvidenceNeeds.has(raw.evidenceNeed) ? (raw.evidenceNeed as RouterOutput["evidenceNeed"]) : defaultEvidenceNeed(scope);
}

export function normalizeRouterOutput(raw: unknown): RouterNormalizationResult {
  if (!isRecord(raw)) return { normalized: raw, warnings: ["router output was not an object"] };

  const warnings: string[] = [];
  const researchScope = normalizedResearchScope(raw);
  const evidenceNeed = normalizedEvidenceNeed(raw, researchScope);
  const normalized: Record<string, unknown> = {
    ...raw,
    researchScope,
    evidenceNeed,
    localDiagnosisRequired:
      typeof raw.localDiagnosisRequired === "boolean" ? raw.localDiagnosisRequired : researchScope === "local_diagnostic" || researchScope === "local_plus_external" || researchScope === "implementation_support",
    externalResearchRequired:
      typeof raw.externalResearchRequired === "boolean" ? raw.externalResearchRequired : evidenceNeed === "external_sources_required" || researchScope === "external_exhaustive",
    exhaustiveCoverageRequired:
      typeof raw.exhaustiveCoverageRequired === "boolean" ? raw.exhaustiveCoverageRequired : researchScope === "external_exhaustive" || researchScope === "local_plus_external",
    sourceBuckets: normalizeSourceBuckets(raw.sourceBuckets, warnings),
    requiredAgents: normalizeRequiredAgents(raw.requiredAgents),
    bypass: normalizeBypass(raw.bypass),
    risks: Array.isArray(raw.risks) ? raw.risks : [],
    reasons: Array.isArray(raw.reasons) && raw.reasons.length > 0 ? raw.reasons : ["Router output normalized; original reasons missing."]
  };

  const diagnostics = isRecord(raw.diagnostics) ? raw.diagnostics : {};
  normalized.diagnostics = {
    ...diagnostics,
    normalized: true,
    normalizationWarnings: warnings
  };

  return { normalized: normalized as Partial<RouterOutput>, warnings };
}
