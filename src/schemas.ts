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
export type ResearchAgentRunStatus = "completed" | "failed" | "timeout" | "spawn_failed" | "context_exhausted" | "manual_fallback";
export type ResearchReportOwner = "parent" | "subagent";
export type SubagentReportStatus = "completed" | "timeout" | "failed" | "searched_but_no_signal";
export type TriggerSource = "hook_user_prompt_submit" | "cli_command" | "manual_user_request" | "agents_md_only" | "skill_only" | "unknown";
export type SubagentStatus = "spawned" | "not_spawned" | "unavailable" | "failed" | "not_applicable";
export type SubagentTriggerSource = "app_tool" | "sdk_threads" | "manual" | "none";

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
  reason: string;
  querySeeds: string[];
  searchedAtLeastOnce: boolean;
  searchedButNoSignal?: boolean;
}

export interface SourceCoverageMatrix {
  task: string;
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
  required_buckets: string[];
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
