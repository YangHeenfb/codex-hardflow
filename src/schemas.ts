export const SOURCE_BUCKETS = [
  "official_docs",
  "github",
  "community",
  "academic",
  "package_registry",
  "security",
  "blogs_engineering",
  "competitors",
  "local_repo",
  "private_connectors",
  "codex_default_discovery"
] as const;

export type SourceBucket = (typeof SOURCE_BUCKETS)[number];
export type Confidence = "high" | "medium" | "low";
export type ValidationStatus = "passed" | "failed" | "blocked" | "not_configured";
export type CodexDefaultDiscoveryStatus = "completed" | "timeout" | "failed" | "not_configured";
export type ResearchRunnerMode = "app_handoff" | "sdk_threads" | "strict_programmatic" | "manual_fallback" | "mixed";
export type ResearchEvidenceMode = "none" | "manual_backfilled" | "app_handoff" | "sdk_threads" | "mixed";
export type ResearchReportStatus = "completed" | "degraded" | "failed";
export type ResearchBucketStatus = "completed" | "searched_but_no_signal" | "failed" | "timeout" | "manual_fallback" | "manual_backfilled" | "context_exhausted";
export type CoverageMode = "exhaustive" | "balanced" | "fast";
export type BucketPriority = "critical" | "normal" | "low";
export type ParallelPolicy = "all_required" | "fixed" | "adaptive" | "wave";
export type RouteStatus = "router_required" | "router_ready" | "router_failed" | "not_required";
export type ResearchAgentRunStatus = "completed" | "failed" | "timeout" | "spawn_failed" | "context_exhausted" | "manual_fallback";
export type ResearchReportOwner = "parent" | "subagent";
export type SubagentReportStatus = "completed" | "timeout" | "failed" | "searched_but_no_signal";
export type TriggerSource = "hook_user_prompt_submit" | "cli_command" | "manual_user_request" | "agents_md_only" | "skill_only" | "unknown";
export type SubagentStatus = "spawned" | "not_spawned" | "unavailable" | "failed" | "not_applicable";
export type SubagentTriggerSource = "app_tool" | "sdk_threads" | "manual" | "none";
export type SdkWorkerStatus = "pending" | "running" | "completed" | "degraded" | "failed" | "timeout" | "cancelled" | "needs_resume";
export type SdkWorkerPoolStatus = "completed" | "degraded" | "failed";
export type WorkerFailureCategory =
  | "transient_network_error"
  | "rate_limit"
  | "sdk_timeout"
  | "no_progress"
  | "no_activity_progress"
  | "no_artifact_progress"
  | "no_semantic_progress"
  | "hard_timeout"
  | "invalid_json"
  | "schema_validation_failed"
  | "permission_error"
  | "config_error"
  | "private_path_violation"
  | "cancelled"
  | "unknown";
export type ProgressCategory =
  | "activity_progress"
  | "artifact_progress"
  | "semantic_progress"
  | "no_activity_progress"
  | "no_artifact_progress"
  | "no_semantic_progress";

export interface TaskClassification {
  researchHeavy: boolean;
  solutionFinding: boolean;
  currentState: boolean;
  troubleshooting: boolean;
  architectureChoice: boolean;
  frameworkChoice: boolean;
  implementation: boolean;
  validationSensitive: boolean;
  parallelModules: boolean;
  privateConnectorsExplicit: boolean;
  securityRelevant: boolean;
  academicRelevant: boolean;
  packageRelevant: boolean;
  competitorRelevant: boolean;
  agentRelevant: boolean;
  evaluationRelevant: boolean;
  productionRelevant: boolean;
  localRepoRelevant: boolean;
}

export interface SourceMatrixEntry {
  bucket: SourceBucket | string;
  required: boolean;
  status?: "required" | "possible" | "not_needed" | "excluded";
  priority?: BucketPriority;
  reason: string;
  querySeeds: string[];
  searchedAtLeastOnce: boolean;
  searchedButNoSignal?: boolean;
  excluded?: boolean;
  excludedReason?: string;
}

export interface ExcludedBucket {
  bucket: SourceBucket | string;
  reason: string;
}

export interface SourceCoverageMatrix {
  task: string;
  coverageMode?: CoverageMode;
  rawUserPrompt?: string;
  normalizedTask?: string;
  classificationInput?: string;
  promptHash?: string;
  runId?: string;
  routerStatus?: "available" | "unavailable";
  routerOutput?: unknown;
  generatedAt: string;
  classification: TaskClassification;
  entries: SourceMatrixEntry[];
  requiredBuckets: string[];
  excludedBuckets?: ExcludedBucket[];
  skippedPossibleBuckets?: string[];
  coverageDebt?: string[];
  promptInjectionCaution: string;
}

export interface ResearchSource {
  bucket?: string;
  title: string;
  source_type: string;
  url_or_ref: string;
  date_or_version: string;
  claim: string;
  confidence: Confidence;
  notes: string;
}

export interface ResearcherReport {
  bucket: string;
  queries_run: string[];
  sources_found: ResearchSource[];
  searched_but_no_signal: boolean;
  uncertainties: string[];
  recommended_followups: string[];
}

export interface ResearchAgentRun {
  agent: string;
  bucket: string;
  status: ResearchAgentRunStatus;
  startedAt: string;
  endedAt: string;
  queries_run: string[];
  sources_found_count: number;
  searched_but_no_signal: boolean;
  failure_reason: string;
  fallback_used: boolean;
}

export interface SdkWorkerState {
  runId: string;
  workerId: string;
  bucket: string;
  threadId: string;
  status: SdkWorkerStatus;
  startedAt: string;
  endedAt: string | null;
  lastHeartbeatAt: string;
  lastCheckpointAt: string;
  lastActivityAt: string;
  lastStreamEventAt: string | null;
  lastToolActivityAt: string | null;
  lastArtifactProgressAt: string;
  lastSemanticProgressAt: string;
  lastCheckpointNudgeAt: string | null;
  partialEvidenceCount: number;
  activityEventCount: number;
  streamEventCount: number;
  toolActivityCount: number;
  checkpointCount: number;
  semanticProgressCount: number;
  sourcesFoundCount: number;
  queriesRunCount: number;
  noSignalCount: number;
  checkpointNudgeCount: number;
  checkpointNudgeSuccessCount: number;
  checkpointNudgeFailedCount: number;
  lastProgressAt: string;
  progressCategory: ProgressCategory;
  noActivityProgressCount: number;
  noArtifactProgressCount: number;
  noSemanticProgressCount: number;
  lastProgressReason: string;
  currentStep: string;
  leaseExpiresAt: string;
  softTimeoutAt: string;
  hardTimeoutAt: string;
  resumeAvailable: boolean;
  failureReason: string;
  failureCategory: WorkerFailureCategory;
  retryable: boolean;
  retryCount: number;
  maxRetries: number;
  lastErrorMessageSanitized: string;
  lastRetryAt: string | null;
  nextRetryAt: string | null;
  retryBackoffMs: number;
  attemptCount: number;
  transientNetworkErrorCount: number;
  rateLimitCount: number;
  sdkTimeoutCount: number;
  retrySuccess: boolean;
  finalAttemptStatus: SdkWorkerStatus | "";
  threadIds: string[];
  resumedThreadIds: string[];
  replacementThreadIds: string[];
  timeLostToBackoffMs: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
}

export interface SdkWorkerRun {
  runId: string;
  workerId: string;
  bucket: string;
  threadId: string;
  status: SdkWorkerStatus;
  startedAt: string;
  endedAt: string;
  lastHeartbeatAt: string;
  lastCheckpointAt: string;
  lastActivityAt: string;
  lastStreamEventAt: string | null;
  lastToolActivityAt: string | null;
  lastArtifactProgressAt: string;
  lastSemanticProgressAt: string;
  lastCheckpointNudgeAt: string | null;
  partialEvidenceCount: number;
  activityEventCount: number;
  streamEventCount: number;
  toolActivityCount: number;
  checkpointCount: number;
  semanticProgressCount: number;
  sourcesFoundCount: number;
  queriesRunCount: number;
  noSignalCount: number;
  checkpointNudgeCount: number;
  checkpointNudgeSuccessCount: number;
  checkpointNudgeFailedCount: number;
  progressCategory: ProgressCategory;
  noActivityProgressCount: number;
  noArtifactProgressCount: number;
  noSemanticProgressCount: number;
  lastProgressReason: string;
  currentStep: string;
  sources_found_count: number;
  searched_but_no_signal: boolean;
  failure_reason: string;
  resumeAvailable: boolean;
  failureCategory: WorkerFailureCategory;
  retryable: boolean;
  retryCount: number;
  maxRetries: number;
  lastErrorMessageSanitized: string;
  attemptCount: number;
  transientNetworkErrorCount: number;
  rateLimitCount: number;
  sdkTimeoutCount: number;
  retrySuccess: boolean;
  finalAttemptStatus: SdkWorkerStatus | "";
  threadIds: string[];
  resumedThreadIds: string[];
  replacementThreadIds: string[];
  timeLostToBackoffMs: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
}

export interface ResearchReport {
  runId: string;
  parentRunId?: string;
  owner: ResearchReportOwner;
  parentTaskPromptHash: string;
  subagentName?: string;
  bucket?: string;
  mergedSubagentReports: string[];
  currentPointerUpdatedAt?: string;
  task: string;
  rawUserPrompt: string;
  normalizedTask: string;
  classificationInput: string;
  promptHash: string;
  turnId: string;
  generatedAt: string;
  taskType: string;
  triggerSource: TriggerSource;
  programmaticTrigger: boolean;
  programmaticMultiAgent: boolean;
  status: ResearchReportStatus;
  runner_mode: ResearchRunnerMode;
  evidence_mode: ResearchEvidenceMode;
  failure_reason?: string;
  strict_programmatic?: boolean;
  sdk_worker_status?: SdkWorkerPoolStatus;
  sdk_worker_runs?: SdkWorkerRun[];
  app_subagent_status?: "not_spawned" | "not_applicable";
  app_handoff_required: boolean;
  sdk_threads_started: boolean;
  sdk_threads_allowed: boolean;
  subagent_instruction_injected: boolean;
  manual_backfill_required: boolean;
  manual_fallback_reason?: string;
  subagent_status: SubagentStatus;
  subagent_trigger_source: SubagentTriggerSource;
  subagent_skip_reason?: string;
  router_trace_reused: boolean;
  router_trace_path?: string;
  router_trace_reuse_reason?: string;
  router_trace_stale_reason?: string;
  source_matrix: SourceCoverageMatrix;
  coverageMode?: CoverageMode;
  parallelPolicy?: ParallelPolicy;
  required_buckets: string[];
  requiredBucketCount?: number;
  completedRequiredBucketCount?: number;
  searchedButNoSignalCount?: number;
  excludedBucketCount?: number;
  excludedBuckets?: ExcludedBucket[];
  skippedPossibleBuckets?: string[];
  coverageDebt?: string[];
  bucket_statuses: Record<string, ResearchBucketStatus>;
  agent_runs: ResearchAgentRun[];
  researcher_reports: ResearcherReport[];
  searched_sources_table: ResearchSource[];
  searched_but_no_signal: string[];
  codex_default_discovery_status: CodexDefaultDiscoveryStatus;
  codex_default_discovery_findings: {
    unexpected_source_buckets: string[];
    followup_recommendations: string[];
  };
  useful_findings: string[];
  conflicting_findings: string[];
  source_gaps: string[];
  confidence_summary: string;
  citations_or_refs: string[];
  prompt_injection_notes: string[];
}

export type ResearchRequestRequestedBy = "planner" | "executor" | "validator" | "reviewer" | "stop_hook";
export type ResearchRequestStage = "planning" | "execution" | "validation" | "review" | "repair";
export type ResearchRequestUrgency = "blocking" | "non_blocking";
export type ResearchRequestStatus = "pending" | "running" | "resolved" | "failed" | "cancelled";

export interface ResearchRequest {
  requestId: string;
  runId: string;
  createdAt: string;
  requestedBy: ResearchRequestRequestedBy;
  stage: ResearchRequestStage;
  reason: string;
  question: string;
  requiredBuckets: string[];
  urgency: ResearchRequestUrgency;
  contextRefs: string[];
  relatedFiles: string[];
  status: ResearchRequestStatus;
  linkedResearchRunId: string | null;
  failureReason?: string;
  resolvedAt?: string;
}

export interface SubagentReport {
  runId: string;
  parentRunId: string;
  agent: string;
  bucket: string;
  status: SubagentReportStatus;
  sources_found: ResearchSource[];
  searched_but_no_signal: boolean;
  queries_run: string[];
  failure_reason: string;
  startedAt: string;
  endedAt: string;
}

export interface PublicTestCaseSummary {
  file: string;
  case_name: string;
  purpose: string;
  inputs_summary: string;
  expected_behavior_summary: string;
}

export interface ExecutorManifest {
  task_id: string;
  changed_files: string[];
  implementation_summary: string;
  assumptions: string[];
  public_tests_added: PublicTestCaseSummary[];
  public_tests_run: string[];
  manual_checks: string[];
  case_coverage_summary: {
    covered_equivalence_classes: string[];
    covered_boundaries: string[];
    covered_error_paths: string[];
    not_covered: string[];
  };
  risk_areas: string[];
  known_limitations: string[];
  externalResearchNeeded?: boolean;
  unresolvedResearchRequests?: string[];
}

export interface ValidationCategory {
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  public_spec_reference: string;
  summary: string;
  public_hint: string;
  likely_affected_area: string;
  leakage_risk_checked: boolean;
}

export interface ValidationSummary {
  validation_id: string;
  iteration: number;
  status: ValidationStatus;
  public_status: "passed" | "failed" | "not_run";
  hidden_status: "passed" | "failed" | "not_configured" | "blocked";
  final_holdout_status: "passed" | "failed" | "not_run";
  failed_count: number;
  categories: ValidationCategory[];
  executor_manifest_read: boolean;
  hidden_tests_disclosed: false;
  regression_bank_updated: boolean;
  fresh_cases_generated: boolean;
  repair_loop_next_action: "repair" | "stop" | "holdout" | "done";
  next_repair_prompt: string;
}

export interface LoopConfig {
  max_repair_cycles: number;
  fresh_cases_per_cycle: number;
  min_holdout_cases: number;
  rerun_regression_bank: boolean;
  stop_on_suspected_cheating: boolean;
}

export interface ModuleSpec {
  id: string;
  prompt: string;
  path_scope: string[];
  test_command?: string;
  dependencies: string[];
}

export interface ModulesFile {
  task: string;
  modules: ModuleSpec[];
  shared_contract_paths: string[];
}
