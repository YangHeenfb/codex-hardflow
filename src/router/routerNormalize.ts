import {
  ROUTER_SOURCE_BUCKETS,
  type RouterOutput,
  type RouterSourceBucket
} from "./routerSchema.js";

export interface RouterNormalizationResult {
  normalized: unknown;
  warnings: string[];
}

const validSourceBuckets = new Set<string>(ROUTER_SOURCE_BUCKETS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      status: typeof item.status === "string" ? item.status : "required",
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

export function normalizeRouterOutput(raw: unknown): RouterNormalizationResult {
  if (!isRecord(raw)) return { normalized: raw, warnings: ["router output was not an object"] };

  const warnings: string[] = [];
  const normalized: Record<string, unknown> = {
    ...raw,
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
