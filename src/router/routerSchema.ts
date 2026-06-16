import { z } from "zod";
import type { CoverageMode, ParallelPolicy, TriggerSource } from "../schemas.js";

export const ROUTES = [
  "direct_answer",
  "research",
  "implementation",
  "validation_sensitive_implementation",
  "parallel_modules",
  "hardflow_maintenance",
  "bypass",
  "clarify",
  "router_failed"
] as const;

export const WORKFLOW_PATTERNS = [
  "direct",
  "router",
  "parallel_research",
  "sequential_pipeline",
  "orchestrator_workers",
  "evaluator_optimizer",
  "parallel_modules",
  "repair_loop"
] as const;

export const RESEARCH_PROFILES = ["none", "light", "broad", "current_state", "competitor", "local_repo_plus_external"] as const;
export const VALIDATION_PROFILES = ["none", "manifest_only", "public_checks", "hidden_validation", "hidden_validation_with_final_holdout"] as const;
export const SOURCE_BUCKET_STATUSES = ["required", "possible", "not_needed"] as const;
export const ROUTER_RISKS = [
  "ambiguous_task",
  "may_need_current_info",
  "may_need_private_context",
  "may_need_hidden_validation",
  "may_need_parallel_isolation",
  "high_prompt_injection_risk",
  "high_cost_or_latency"
] as const;

export const ROUTER_SOURCE_BUCKETS = [
  "local_repo",
  "official_docs",
  "github",
  "community",
  "academic",
  "package_registry",
  "security",
  "blogs_engineering",
  "competitors",
  "private_connectors",
  "codex_default_discovery"
] as const;

export const RouterSourceBucketSchema = z.object({
  bucket: z.enum(ROUTER_SOURCE_BUCKETS),
  status: z.enum(SOURCE_BUCKET_STATUSES),
  reason: z.string().min(1)
});

export const RouterRequiredAgentSchema = z.object({
  name: z.string().min(1),
  required: z.literal(true),
  reason: z.string().min(1)
});

export const RouterOutputSchema = z.object({
  route: z.enum(ROUTES),
  workflowPattern: z.enum(WORKFLOW_PATTERNS),
  researchProfile: z.enum(RESEARCH_PROFILES),
  validationProfile: z.enum(VALIDATION_PROFILES),
  sourceBuckets: z.array(RouterSourceBucketSchema),
  requiredAgents: z.array(RouterRequiredAgentSchema),
  requiresSourceMatrix: z.boolean(),
  requiresExecutorManifest: z.boolean(),
  requiresValidation: z.boolean(),
  requiresFinalHoldout: z.boolean(),
  requiresParallelIsolation: z.boolean(),
  reasons: z.array(z.string()),
  risks: z.array(z.enum(ROUTER_RISKS)),
  bypass: z.object({
    requested: z.boolean(),
    reason: z.string()
  }),
  diagnostics: z.record(z.string(), z.unknown()).optional()
});

export type RouterOutput = z.infer<typeof RouterOutputSchema>;
export type RouterSourceBucket = z.infer<typeof RouterSourceBucketSchema>;
export type RouterRoute = RouterOutput["route"];
export type RouterMode = "llm" | "router_failed" | "semantic_bypass" | "explicit_config_bypass";
export type RouterTraceOwner = "parent" | "subagent";

export interface RouterInput {
  rawUserPrompt: string;
  normalizedTask?: string;
  currentRepoContext?: string;
  availableAgents?: AvailableAgent[];
  hardflowPolicies?: string[];
  previousHookMarker?: Record<string, unknown>;
  currentRunId?: string;
  existingAppHandoffState?: Record<string, unknown>;
  explicitHardflowMode?: string;
  triggerSource?: TriggerSource;
  programmaticTrigger?: boolean;
}

export interface AvailableAgent {
  name: string;
  description: string;
  tools: string[];
  permissions: string[];
}

export interface RouterTrace {
  runId?: string;
  turnId?: string;
  owner: RouterTraceOwner;
  parentRunId?: string;
  subagentName?: string;
  bucket?: string;
  triggerSource: TriggerSource;
  programmaticTrigger: boolean;
  rawUserPrompt: string;
  normalizedTask?: string;
  promptHash: string;
  routerMode: RouterMode;
  route: RouterOutput["route"];
  coverageMode: CoverageMode | null;
  parallelPolicy: ParallelPolicy | null;
  workflowPattern: RouterOutput["workflowPattern"];
  researchProfile: RouterOutput["researchProfile"];
  validationProfile: RouterOutput["validationProfile"];
  sourceBuckets: RouterOutput["sourceBuckets"];
  requiredAgents: RouterOutput["requiredAgents"];
  requiresSourceMatrix: boolean;
  requiresExecutorManifest: boolean;
  requiresValidation: boolean;
  requiresFinalHoldout: boolean;
  requiresParallelIsolation: boolean;
  reasons: string[];
  risks: RouterOutput["risks"];
  fallbackReason?: string;
  createdAt: string;
  routerOutput: RouterOutput;
}

export function parseRouterOutput(value: unknown): RouterOutput {
  return RouterOutputSchema.parse(value);
}
