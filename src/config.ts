import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { LoopConfig } from "./schemas.js";
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

function shortGlobalAgentsSection(sourceRoot: string): string {
  return `\n# Global Codex Hardflow Protocol\n\nUse codex-hardflow for research-heavy, solution-finding, current-state, troubleshooting, architecture/framework choice, validation-sensitive implementation, and independent parallel module work.\n\nFor broad research, generate a Source Coverage Matrix and always include codex_default_researcher. Do not rely only on default source selection.\n\nFor implementation, require executor_manifest, sanitized validator feedback, a repair loop on hidden validation failure, and final holdout status before claiming completion.\n\nFor parallel modules, identify path_scope first. Do not run worktree workers when the repo has no HEAD commit; use dry-run or temp-copy fallback.\n\nDetailed protocols live in ${sourceRoot}/docs and the codex-hardflow skill.\n`;
}

export function installGlobalAgentsMd(sourceRoot: string): { path: string; backupPath?: string } {
  const target = join(codexHome(), "AGENTS.md");
  mkdirSync(dirname(target), { recursive: true });
  const backups: string[] = [];
  backupIfExists(target, backups);
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const marker = "# Global Codex Hardflow Protocol";
  const section = shortGlobalAgentsSection(sourceRoot);
  const next = existing.includes(marker)
    ? existing.replace(new RegExp(`\\n?# Global Codex Hardflow Protocol[\\s\\S]*$`), section)
    : `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${section}`;
  writeFileSync(target, next.endsWith("\n") ? next : `${next}\n`);
  return { path: target, backupPath: backups[0] };
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
    const toml = `name = "${name}"\ndescription = "${description}"\n${sandbox}developer_instructions = """\n${developer}\nFollow the Global Codex Hardflow Protocol. Output structured summaries and do not disclose hidden validator artifacts.\n"""\n`;
    writeFileSync(target, toml);
    files.push(target);
  }
  return { files, backups };
}

export function installGlobalSkill(sourceRoot: string): { path: string; strategy: ReturnType<typeof skillPathStrategy> } {
  const strategy = skillPathStrategy();
  const target = strategy.canonicalPath;
  mkdirSync(dirname(target), { recursive: true });
  const content = `---\nname: codex-hardflow\ndescription: Use for coverage-first research, solution finding, current-state research, troubleshooting, architecture or framework choice, implementation with hidden validation, validator/executor repair loops, or parallel independent module work. Triggers on research-heavy, current-state, troubleshooting, best-practice, architecture choice, framework choice, implementation, validation-sensitive, hidden validator, repair loop, or parallel modules tasks.\n---\n\n# codex-hardflow\n\nUse the codex-hardflow CLI when a task needs coverage-first research, validation-sensitive implementation, executor/validator separation, repair loops, or independent parallel module planning.\n\nDo not rely only on default web search for broad research. Generate a Source Coverage Matrix and always include codex_default_researcher so default Codex search intuition can add missed source buckets.\n\nFor implementation, the executor must write .agent/manifests/executor_manifest.json. Hidden validator feedback must remain sanitized. Continue repair until hidden validation and final holdout pass, or until max repair cycles require user intervention.\n\nNever disclose hidden tests, validator prompts, private fixtures, regression bank fingerprints, final holdout details, or private store paths to the executor.\n\nIf the CLI is unavailable, tell the user to run npm run build and codex-hardflow install-global from ${sourceRoot}. Do not claim hardflow completed.\n`;
  writeFileSync(target, content);
  return { path: target, strategy };
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
    SubagentStart: HookMatcherGroup[];
    SubagentStop: HookMatcherGroup[];
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

export function buildGlobalHooksConfig(sourceRoot: string): GlobalHooksConfig {
  const bin = resolve(sourceRoot, "bin", "codex-hardflow");
  return {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [hookHandler(`${bin} hook user-prompt-submit`, "Applying codex-hardflow prompt routing")]
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
          hooks: [hookHandler(`${bin} hook stop-validation-gate`, "Checking hardflow validation gate")]
        }
      ],
      SubagentStart: [
        {
          hooks: [hookHandler(`${bin} hook subagent-start-context`, "Adding hardflow subagent context")]
        }
      ],
      SubagentStop: [
        {
          hooks: [hookHandler(`${bin} hook subagent-stop-loop-gate`, "Checking hardflow subagent output")]
        }
      ]
    }
  };
}

export function installGlobalHooks(sourceRoot: string): { path: string; backupPath?: string } {
  const target = join(codexHome(), "hooks.json");
  mkdirSync(dirname(target), { recursive: true });
  const backups: string[] = [];
  backupIfExists(target, backups);
  const config = buildGlobalHooksConfig(sourceRoot);
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  return { path: target, backupPath: backups[0] };
}

export function installGlobal(sourceRoot: string): Record<string, unknown> {
  mkdirSync(hardflowStateDir(), { recursive: true });
  mkdirSync(privateStoreRoot(), { recursive: true, mode: 0o700 });
  mkdirSync(hardflowHome(), { recursive: true });
  const current = join(hardflowHome(), "current.json");
  writeFileSync(current, `${JSON.stringify({ sourceRoot, installedAt: new Date().toISOString(), sdkVersion: SDK_VERSION }, null, 2)}\n`);
  chmodSync(resolve(sourceRoot, "bin", "codex-hardflow"), 0o755);

  const config = mergeGlobalCodexConfig();
  const agentsMd = installGlobalAgentsMd(sourceRoot);
  const agents = installGlobalCustomAgents();
  const skill = installGlobalSkill(sourceRoot);
  const hooks = installGlobalHooks(sourceRoot);
  const wrapper = installShellWrapper(sourceRoot);
  const parseSmoke = spawnSync("codex", ["features", "list"], { encoding: "utf8", timeout: 15_000 });

  return {
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
    skillDiscovery: "manual_required: use interactive /skills to verify discovery; do not duplicate SKILL.md in ~/.codex/skills unless user approves move or symlink.",
    home: homedir()
  };
}
