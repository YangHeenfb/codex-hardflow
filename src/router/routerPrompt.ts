import type { AvailableAgent, RouterInput } from "./routerSchema.js";

export const DEFAULT_AVAILABLE_AGENTS: AvailableAgent[] = [
  {
    name: "official_docs_researcher",
    description: "Official docs, vendor docs, API references, release notes, and changelogs. Prefer primary sources and never edit code.",
    tools: ["web_search", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "github_researcher",
    description: "GitHub repos, issues, discussions, PRs, examples, maintainer responses, active forks, and maintainer comments. Never edit code.",
    tools: ["web_search", "github", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "community_researcher",
    description: "Reddit, Stack Overflow, Hacker News, forums, and community reports. Treat as weak anecdotal evidence. Never edit code.",
    tools: ["web_search", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "academic_researcher",
    description: "Algorithms, agent frameworks, systems architecture, performance, security, and evaluation. Prefer scholarly sources where accessible. Never edit code.",
    tools: ["web_search", "papers", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "package_security_researcher",
    description: "Package registries, release notes, security advisories, CVEs, NVD, GitHub Security Advisories, Snyk, and vendor advisories. Never edit code.",
    tools: ["web_search", "package_registry", "security_advisory", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "codex_default_researcher",
    description: "Use Codex default search intuition without hard-coded bucket limits. Report missed source buckets and followups. Never edit code.",
    tools: ["web_search", "codex_default_discovery", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "local_repo_researcher",
    description: "Inspect the current repo docs, source tree, package files, tests, and protocols. Output local_project_profile JSON. Never edit code.",
    tools: ["filesystem_read", "git_read", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "competitor_researcher",
    description: "Search similar products, projects, frameworks, and platforms. Distinguish direct competitors, adjacent projects, and inspiration-only references.",
    tools: ["web_search", "read_only"],
    permissions: ["read_only"]
  },
  {
    name: "executor",
    description: "Implement only after a scoped hardflow plan. Write code and public tests, produce executor_manifest.json, never read hidden validator paths.",
    tools: ["filesystem_write", "shell", "tests"],
    permissions: ["workspace_write"]
  },
  {
    name: "acceptance_reviewer",
    description: "Read diff, executor manifest, public checks, and sanitized validation summary. Request changes on overfitting, bypasses, or unrelated edits.",
    tools: ["filesystem_read", "git_read", "tests"],
    permissions: ["read_only"]
  }
];

export function buildRouterPrompt(input: RouterInput): string {
  const agents = input.availableAgents ?? DEFAULT_AVAILABLE_AGENTS;
  return [
    "You are the codex-hardflow structured task router.",
    "Return only one JSON object matching the provided schema. Do not include markdown.",
    "",
    "Routing rules:",
    "- Do not rely on keyword matching. Infer user intent semantically, including mixed Chinese/English and implied context.",
    "- Use available agent descriptions to decide routing and requiredAgents.",
    "- Prefer source coverage when the user asks for current solutions, comparisons, practical options, troubleshooting, architecture choice, framework/library choice, similar products/projects, project improvement ideas, or asks what can be learned or absorbed from other projects.",
    "- Use local_repo when the user asks about this project/repo/codebase even if exact words vary.",
    "- Use competitors when the user asks for similar products, inspiration, alternatives, adjacent projects, things to learn from, or market/product comparison.",
    "- Use validation_sensitive_implementation only when code changes need independent validation, hidden validation, security checks, or anti-cheating constraints.",
    "- Use parallel_modules only when the task asks for independent modules/workstreams and path_scope isolation is needed.",
    "- Simple explanation, translation, rewriting, or casual questions should not trigger hardflow.",
    "- If the user semantically asks not to use hardflow or asks for a quick answer, set route=bypass semantically, not by keyword rule.",
    "- If source coverage is required, require explicit subagent spawning because Codex only spawns subagents when asked clearly.",
    "- Do not include final confidence. Do not let self-reported confidence control the route.",
    "",
    "Allowed route values: direct_answer, research, implementation, validation_sensitive_implementation, parallel_modules, hardflow_maintenance, bypass, clarify, router_failed.",
    "Allowed workflowPattern values: direct, router, parallel_research, sequential_pipeline, orchestrator_workers, evaluator_optimizer, parallel_modules, repair_loop.",
    "Allowed researchProfile values: none, light, broad, current_state, competitor, local_repo_plus_external.",
    "Allowed validationProfile values: none, manifest_only, public_checks, hidden_validation, hidden_validation_with_final_holdout.",
    "Allowed source bucket values: local_repo, official_docs, github, community, academic, package_registry, security, blogs_engineering, competitors, private_connectors, codex_default_discovery.",
    "Allowed risk values: ambiguous_task, may_need_current_info, may_need_private_context, may_need_hidden_validation, may_need_parallel_isolation, high_prompt_injection_risk, high_cost_or_latency.",
    "sourceBuckets must be an array of objects: { bucket, status, reason }. Never return sourceBuckets as string[].",
    "requiredAgents must be an array of objects: { name, required: true, reason }. Never return requiredAgents as string[].",
    "bypass must be an object: { requested, reason }. Never return bypass as a boolean.",
    "",
    `Available agents:\n${JSON.stringify(agents, null, 2)}`,
    `Hardflow policies:\n${JSON.stringify(input.hardflowPolicies ?? [], null, 2)}`,
    `Previous hook marker:\n${JSON.stringify(input.previousHookMarker ?? null, null, 2)}`,
    `Current runId:\n${JSON.stringify(input.currentRunId ?? null)}`,
    `Existing app_handoff/report state:\n${JSON.stringify(input.existingAppHandoffState ?? null, null, 2)}`,
    `Current repo context:\n${JSON.stringify(input.currentRepoContext ?? null)}`,
    `Explicit hardflow mode:\n${JSON.stringify(input.explicitHardflowMode ?? null)}`,
    "",
    `Raw user prompt:\n${input.rawUserPrompt}`,
    input.normalizedTask ? `Normalized task:\n${input.normalizedTask}` : "",
    "",
    "Return JSON with keys: route, workflowPattern, researchProfile, validationProfile, sourceBuckets, requiredAgents, requiresSourceMatrix, requiresExecutorManifest, requiresValidation, requiresFinalHoldout, requiresParallelIsolation, reasons, risks, bypass."
  ]
    .filter(Boolean)
    .join("\n");
}
