import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { LoopConfig } from "./schemas.js";
import type { HardflowRouterProvider, HardflowWorkerProvider } from "./jobs/jobSchema.js";
import { installShellWrapper } from "./cliPaths.js";
import { codexHome, hardflowHome, hardflowStateDir, privateStoreRoot, skillPathStrategy } from "./paths.js";

export const SDK_VERSION = "0.134.0";

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  max_repair_cycles: 3,
  fresh_cases_per_cycle: 5,
  min_holdout_cases: 5,
  rerun_regression_bank: true,
  stop_on_suspected_cheating: true
};

export interface TriggerRuntimeConfig {
  autoRouteOnUserPromptSubmit: boolean;
  routePreflightTimeoutMs: number;
  stopAutoRouteFallback: boolean;
  autoRunStrictResearchInStop: boolean;
  strictResearchStopTimeoutMs: number;
  allowQuickAnswerBypass: boolean;
  userPromptSubmitMode: "enqueue_job" | "direct_route";
}

export const DEFAULT_TRIGGER_RUNTIME_CONFIG: TriggerRuntimeConfig = {
  autoRouteOnUserPromptSubmit: false,
  routePreflightTimeoutMs: 45_000,
  stopAutoRouteFallback: false,
  autoRunStrictResearchInStop: false,
  strictResearchStopTimeoutMs: 1_800_000,
  allowQuickAnswerBypass: true,
  userPromptSubmitMode: "enqueue_job"
};

export interface DaemonRuntimeConfig {
  enabled: boolean;
  pollIntervalMs: number;
  maxConcurrentJobs: number;
  maxGlobalSdkWorkers: number;
  maxConcurrentForegroundJobs: number;
  maxConcurrentBackgroundJobs: number;
}

export interface RouterRuntimeConfig {
  provider: HardflowRouterProvider;
}

export interface WorkerRuntimeConfig {
  provider: HardflowWorkerProvider;
}

export const DEFAULT_DAEMON_RUNTIME_CONFIG: DaemonRuntimeConfig = {
  enabled: true,
  pollIntervalMs: 1_000,
  maxConcurrentJobs: 4,
  maxGlobalSdkWorkers: 32,
  maxConcurrentForegroundJobs: 4,
  maxConcurrentBackgroundJobs: 2
};

export const DEFAULT_ROUTER_RUNTIME_CONFIG: RouterRuntimeConfig = {
  provider: "codex_cli"
};

export const DEFAULT_WORKER_RUNTIME_CONFIG: WorkerRuntimeConfig = {
  provider: "codex_sdk"
};

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backupIfExists(filePath: string, backups: string[]): void {
  if (!existsSync(filePath)) return;
  const backup = `${filePath}.bak.${timestamp()}`;
  copyFileSync(filePath, backup);
  backups.push(backup);
}

function setKeyInSection(toml: string, section: string | null, key: string, value: string): string {
  const lines = toml.length ? toml.split("\n") : [];
  const sectionHeader = section ? `[${section}]` : null;
  let start = 0;
  let end = lines.length;

  if (sectionHeader) {
    const index = lines.findIndex((line) => line.trim() === sectionHeader);
    if (index === -1) {
      const suffix = toml.endsWith("\n") || toml.length === 0 ? "" : "\n";
      return `${toml}${suffix}\n${sectionHeader}\n${key} = ${value}\n`;
    }
    start = index + 1;
    end = lines.findIndex((line, lineIndex) => lineIndex > index && /^\s*\[.+\]\s*$/.test(line));
    if (end === -1) end = lines.length;
  } else {
    end = lines.findIndex((line) => /^\s*\[.+\]\s*$/.test(line));
    if (end === -1) end = lines.length;
  }

  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  for (let i = start; i < end; i += 1) {
    if (keyPattern.test(lines[i] ?? "")) {
      lines[i] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }
  lines.splice(end, 0, `${key} = ${value}`);
  return lines.join("\n");
}

function configFieldSupported(snippet: string): boolean {
  const tmp = mkdtempSync(join(tmpdir(), "codex-hardflow-config-"));
  try {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "config.toml"), snippet);
    const result = spawnSync("codex", ["--strict-config", "-a", "never", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--model", "invalid-model", "--json", "config probe"], {
      env: { ...process.env, CODEX_HOME: tmp, TERM: process.env.TERM ?? "dumb" },
      encoding: "utf8",
      timeout: 3_000
    });
    return !`${result.stderr ?? ""}${result.stdout ?? ""}`.includes("unknown configuration field");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Cleanup failure should not make install-global fail; temp dirs are outside package output.
    }
  }
}

export interface ConfigMergeResult {
  changed: boolean;
  skipped: string[];
  backupPath?: string;
}

export type InstallMode = "strict" | "assisted";

export interface InstallGlobalOptions {
  mode?: InstallMode;
  withSkill?: boolean;
  withAppAgents?: boolean;
  withAgentsDocs?: boolean;
}

export interface EffectiveInstallGlobalOptions {
  mode: InstallMode;
  withSkill: boolean;
  withAppAgents: boolean;
  withAgentsDocs: boolean;
}

export function resolveInstallGlobalOptions(options: InstallGlobalOptions = {}): EffectiveInstallGlobalOptions {
  const mode = options.mode ?? "strict";
  return {
    mode,
    withSkill: options.withSkill ?? mode === "assisted",
    withAppAgents: options.withAppAgents ?? mode === "assisted",
    withAgentsDocs: options.withAgentsDocs ?? mode === "assisted"
  };
}

export function mergeGlobalCodexConfig(): ConfigMergeResult {
  const home = codexHome();
  mkdirSync(home, { recursive: true });
  const configPath = join(home, "config.toml");
  const backups: string[] = [];
  backupIfExists(configPath, backups);
  let toml = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const before = toml;
  const skipped: string[] = [];

  const desired = [
    { section: null, key: "web_search", value: "\"live\"", snippet: "web_search = \"live\"\n" },
    { section: "tools.web_search", key: "context_size", value: "\"high\"", snippet: "[tools.web_search]\ncontext_size = \"high\"\n" },
    { section: "agents", key: "max_threads", value: "6", snippet: "[agents]\nmax_threads = 6\n" },
    { section: "agents", key: "max_depth", value: "1", snippet: "[agents]\nmax_depth = 1\n" },
    { section: "features", key: "hooks", value: "true", snippet: "[features]\nhooks = true\n" }
  ] as const;

  for (const item of desired) {
    if (configFieldSupported(item.snippet)) {
      toml = setKeyInSection(toml, item.section, item.key, item.value);
    } else {
      skipped.push(`${item.section ? `${item.section}.` : ""}${item.key}`);
    }
  }

  if (toml !== before) {
    writeFileSync(configPath, toml.endsWith("\n") ? toml : `${toml}\n`);
  }
  return { changed: toml !== before, skipped, backupPath: backups[0] };
}

const GLOBAL_AGENTS_MARKER = "# Global Codex Hardflow Protocol";

function globalAgentsDocsSection(sourceRoot: string): string {
  return `\n# Global Codex Hardflow Protocol\n\nAGENTS.md is protocol documentation, not a hardflow trigger. Research-heavy tasks should be routed by UserPromptSubmit/Router, not by AGENTS.md alone. Hardflow is active only when a UserPromptSubmit marker/router_trace exists or the user/CLI explicitly runs codex-hardflow. Do not claim hardflow was executed unless programmaticTrigger=true or the user explicitly ran codex-hardflow.\n\nIf a codex-hardflow marker/router_trace exists, follow its runId, triggerSource, routerOutput, CoveragePlan, EvidenceLedger, report ownership, and evidence gates. If no marker/router_trace exists, answer normally or ask whether to use hardflow.\n\nParent router traces live at .agent/reports/runs/<runId>/router_trace.json. Coverage plans and evidence ledgers live at .agent/reports/runs/<runId>/coverage_plan.json and .agent/reports/runs/<runId>/evidence_ledger.json. Parent reports live at .agent/reports/runs/<runId>/research_report.json. Router route=research defaults to strict_programmatic SDK threads, coverageMode=exhaustive, and parallelPolicy=all_required. App subagents are optional best-effort workers, not the strict coverage mechanism; if they are not actually spawned, record subagent_status=\"not_spawned\" and subagent_skip_reason.\n\nUse stable codex-hardflow CLI report commands with --run-id for backfill. Dev entrypoints are for explicit maintainer work only. Detailed protocols live in ${sourceRoot}/docs and the codex-hardflow skill.\n`;
}

export function globalAgentsMdHasHardflowBlock(): boolean {
  const target = join(codexHome(), "AGENTS.md");
  if (!existsSync(target)) return false;
  return readFileSync(target, "utf8").includes(GLOBAL_AGENTS_MARKER);
}

export function removeGlobalAgentsMdBlock(): { path: string; removed: boolean; backupPath?: string } {
  const target = join(codexHome(), "AGENTS.md");
  mkdirSync(dirname(target), { recursive: true });
  if (!existsSync(target)) return { path: target, removed: false };
  const existing = readFileSync(target, "utf8");
  if (!existing.includes(GLOBAL_AGENTS_MARKER)) return { path: target, removed: false };
  const backups: string[] = [];
  backupIfExists(target, backups);
  const next = existing.replace(new RegExp(`\\n?${GLOBAL_AGENTS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*$`), "").trimEnd();
  writeFileSync(target, next.length > 0 ? `${next}\n` : "");
  return { path: target, removed: true, backupPath: backups[0] };
}

export function installGlobalAgentsMdDocs(sourceRoot: string): { path: string; installed: boolean; backupPath?: string } {
  const target = join(codexHome(), "AGENTS.md");
  mkdirSync(dirname(target), { recursive: true });
  const backups: string[] = [];
  backupIfExists(target, backups);
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const section = globalAgentsDocsSection(sourceRoot);
  const next = existing.includes(GLOBAL_AGENTS_MARKER)
    ? existing.replace(new RegExp(`\\n?${GLOBAL_AGENTS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*$`), section)
    : `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${section}`;
  writeFileSync(target, next.endsWith("\n") ? next : `${next}\n`);
  return { path: target, installed: true, backupPath: backups[0] };
}

const agentDefinitions = [
  ["official_docs_researcher", "Official docs, vendor docs, API references, release notes, and changelogs. Prefer primary sources and never edit code.", true],
  ["github_researcher", "GitHub repos, issues, discussions, PRs, examples, maintainer responses, real bugs, workarounds, closed issues, and active forks. Never edit code.", true],
  ["community_researcher", "Reddit, Stack Overflow, Hacker News, forums, and community reports. Treat as weak anecdotal evidence and mark unverified. Never edit code.", true],
  ["academic_researcher", "Algorithms, agent frameworks, systems architecture, performance, security, and evaluation. Prefer scholarly sources where accessible. Never edit code.", true],
  ["package_security_researcher", "Package registries, release notes, security advisories, CVEs, NVD, GitHub Security Advisories, Snyk, and vendor advisories. Never edit code.", true],
  ["codex_default_researcher", "Use Codex default search intuition without hard-coded bucket limits. Report sources considered, used, not used, unexpected buckets, and followups. Never edit code.", true],
  ["local_repo_researcher", "Inspect the current repo docs, source tree, package files, tests, and protocols. Output local_project_profile JSON with modules, assumptions, gaps, and risks. Never edit code.", true],
  ["competitor_researcher", "Search similar products, projects, frameworks, and platforms. Output competitor_matrix JSON and distinguish direct competitors, adjacent projects, and inspiration-only references. Never edit code.", true],
  ["executor", "Implement only after a scoped hardflow plan. Write code and public tests only, produce executor_manifest.json, never read hidden validator paths, and never hardcode hidden cases.", false],
  ["acceptance_reviewer", "Read diff, executor manifest, public checks, and sanitized validation summary. Do not read hidden tests. Request changes on hardcoding, overfitting, bypasses, or unrelated large edits.", true]
] as const;

export function installGlobalCustomAgents(): { files: string[]; backups: string[] } {
  const dir = join(codexHome(), "agents");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const backups: string[] = [];
  for (const [name, description, readOnly] of agentDefinitions) {
    const target = join(dir, `${name}.toml`);
    backupIfExists(target, backups);
    const sandbox = readOnly ? 'sandbox_mode = "read-only"\n' : "";
    const developer = description
      .replace(/\\/g, "\\\\")
      .replace(/"""/g, '\\"\\"\\"');
    const toml = `name = "${name}"\ndescription = "${description}"\n${sandbox}developer_instructions = """\n${developer}\nOperate only as an explicitly installed assisted-mode role. Output structured summaries and do not disclose private validation artifacts.\n"""\n`;
    writeFileSync(target, toml);
    files.push(target);
  }
  return { files, backups };
}

export function installGlobalSkill(sourceRoot: string): { path: string; strategy: ReturnType<typeof skillPathStrategy> } {
  const strategy = skillPathStrategy();
  const target = strategy.canonicalPath;
  mkdirSync(dirname(target), { recursive: true });
  const content = `---\nname: codex-hardflow\ndescription: Protocol documentation for codex-hardflow markers, router traces, run-owned reports, CoveragePlan, EvidenceLedger, source coverage, and validation gates. The skill itself is not an enforcement trigger.\n---\n\n# codex-hardflow\n\nThis skill is protocol documentation, not a hardflow trigger. Research-heavy tasks should be routed by UserPromptSubmit/Router, not by this skill alone. Hardflow is active only when a UserPromptSubmit marker/router_trace exists or the user/CLI explicitly runs codex-hardflow. Do not claim hardflow was executed unless programmaticTrigger=true or the user explicitly ran codex-hardflow.\n\nIf a codex-hardflow marker/router_trace exists, follow its runId, triggerSource, routerOutput, CoveragePlan, EvidenceLedger, report ownership, subagent status, and evidence gates. If no marker/router_trace exists, answer normally or ask whether to use hardflow.\n\nParent router traces live at .agent/reports/runs/<runId>/router_trace.json. Coverage plans and evidence ledgers live at .agent/reports/runs/<runId>/coverage_plan.json and .agent/reports/runs/<runId>/evidence_ledger.json. Parent reports live at .agent/reports/runs/<runId>/research_report.json. Router route=research defaults to strict_programmatic SDK threads, coverageMode=exhaustive, and parallelPolicy=all_required. Subagent reports/traces must stay under .agent/reports/runs/<runId>/subagents/. App subagents are optional best-effort workers, not the strict coverage mechanism; if they are not actually spawned, record subagent_status=\"not_spawned\" and subagent_skip_reason. Manual search must be backfilled as manual evidence, not claimed as strict programmatic research.\n\nUse stable codex-hardflow CLI report commands with --run-id for backfill. Use --strict-programmatic when hardflow must rely on SDK threads instead of App/AGENTS/skill guidance. Dev entrypoints are for explicit maintainer work only.\n\nNever disclose hidden tests, validator prompts, private fixtures, regression bank fingerprints, final holdout details, or private store paths. If the CLI is unavailable, tell the user to run npm run build and codex-hardflow install-global from ${sourceRoot}. Do not claim hardflow completed.\n`;
  writeFileSync(target, content);
  return { path: target, strategy };
}

export function disableGlobalSkill(): {
  path: string;
  paths: string[];
  disabled: boolean;
  disabledPaths: string[];
  backupPath?: string;
  backupPaths: string[];
  strategy: ReturnType<typeof skillPathStrategy>;
} {
  const strategy = skillPathStrategy();
  const backups: string[] = [];
  const disabledPaths: string[] = [];
  for (const target of [strategy.canonicalPath, strategy.legacyPath]) {
    if (!existsSync(target)) continue;
    backupIfExists(target, backups);
    rmSync(target, { force: true });
    disabledPaths.push(target);
  }
  return {
    path: strategy.canonicalPath,
    paths: [strategy.canonicalPath, strategy.legacyPath],
    disabled: disabledPaths.length > 0,
    disabledPaths,
    backupPath: backups[0],
    backupPaths: backups,
    strategy: skillPathStrategy()
  };
}

export interface HookCommandHandler {
  type: "command";
  command: string;
  timeout: number;
  statusMessage: string;
}

export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookCommandHandler[];
}

export interface GlobalHooksConfig {
  hooks: {
    UserPromptSubmit: HookMatcherGroup[];
    PreToolUse: HookMatcherGroup[];
    Stop: HookMatcherGroup[];
    SubagentStart?: HookMatcherGroup[];
    SubagentStop?: HookMatcherGroup[];
  };
}

function hookHandler(command: string, statusMessage: string, timeout = 30): HookCommandHandler {
  return {
    type: "command",
    command,
    timeout,
    statusMessage
  };
}

export function buildGlobalHooksConfig(sourceRoot: string, options: { withAppAgents?: boolean } = {}): GlobalHooksConfig {
  const bin = resolve(sourceRoot, "bin", "codex-hardflow");
  const config: GlobalHooksConfig = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [hookHandler(`${bin} hook user-prompt-submit`, "Applying codex-hardflow prompt routing", Math.ceil(DEFAULT_TRIGGER_RUNTIME_CONFIG.routePreflightTimeoutMs / 1000) + 15)]
        }
      ],
      PreToolUse: [
        {
          matcher: "Bash|apply_patch|Edit|Write|mcp__.*filesystem.*",
          hooks: [hookHandler(`${bin} hook pre-tool-use-private-path-guard`, "Checking hardflow private path guard")]
        }
      ],
      Stop: [
        {
          hooks: [hookHandler(`${bin} hook stop-validation-gate`, "Checking hardflow validation gate", Math.ceil(DEFAULT_TRIGGER_RUNTIME_CONFIG.strictResearchStopTimeoutMs / 1000) + 60)]
        }
      ]
    }
  };
  if (options.withAppAgents) {
    config.hooks.SubagentStart = [
      {
        hooks: [hookHandler(`${bin} hook subagent-start-context`, "Adding hardflow subagent context")]
      }
    ];
    config.hooks.SubagentStop = [
      {
        hooks: [hookHandler(`${bin} hook subagent-stop-loop-gate`, "Checking hardflow subagent output")]
      }
    ];
  }
  return config;
}

export function installGlobalHooks(sourceRoot: string, options: { withAppAgents?: boolean } = {}): { path: string; backupPath?: string } {
  const target = join(codexHome(), "hooks.json");
  mkdirSync(dirname(target), { recursive: true });
  const backups: string[] = [];
  backupIfExists(target, backups);
  const config = buildGlobalHooksConfig(sourceRoot, options);
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  return { path: target, backupPath: backups[0] };
}

export function installGlobal(sourceRoot: string, options: InstallGlobalOptions = {}): Record<string, unknown> {
  const effective = resolveInstallGlobalOptions(options);
  mkdirSync(hardflowStateDir(), { recursive: true });
  mkdirSync(privateStoreRoot(), { recursive: true, mode: 0o700 });
  mkdirSync(hardflowHome(), { recursive: true });
  const current = join(hardflowHome(), "current.json");
  writeFileSync(current, `${JSON.stringify({ sourceRoot, installedAt: new Date().toISOString(), sdkVersion: SDK_VERSION }, null, 2)}\n`);
  chmodSync(resolve(sourceRoot, "bin", "codex-hardflow"), 0o755);

  const config = mergeGlobalCodexConfig();
  const agentsMd = effective.withAgentsDocs ? installGlobalAgentsMdDocs(sourceRoot) : removeGlobalAgentsMdBlock();
  const agents = effective.withAppAgents ? installGlobalCustomAgents() : { installed: false, files: [], backups: [] };
  const skill = effective.withSkill ? { installed: true, ...installGlobalSkill(sourceRoot) } : { installed: false, ...disableGlobalSkill() };
  const hooks = installGlobalHooks(sourceRoot, { withAppAgents: effective.withAppAgents });
  const wrapper = installShellWrapper(sourceRoot);
  const parseSmoke = spawnSync("codex", ["features", "list"], { encoding: "utf8", timeout: 15_000 });
  const strategy = skillPathStrategy();

  return {
    mode: effective.mode,
    strictProgrammaticInstall: effective.mode === "strict" && !effective.withAgentsDocs && !effective.withSkill && !effective.withAppAgents,
    activeSkillInstalled: strategy.canonicalExists || strategy.legacyExists,
    hardflowAgentsMdBlockInstalled: globalAgentsMdHasHardflowBlock(),
    config,
    agentsMd,
    agents,
    skill,
    hooks,
    wrapper,
    stateManifest: current,
    privateStoreCreated: true,
    parseSmokePassed: parseSmoke.status === 0,
    hooksTrust: "pending: open interactive Codex CLI, run /hooks, review, and trust. TERM=dumb cannot complete trust.",
    skillDiscovery: effective.withSkill
      ? "manual_required: use interactive /skills to verify discovery; do not duplicate SKILL.md in ~/.codex/skills unless user approves move or symlink."
      : "not_installed: strict mode does not install the codex-hardflow skill unless --with-skill is requested.",
    home: homedir()
  };
}
