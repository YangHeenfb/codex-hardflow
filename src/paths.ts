import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

export function codexHome(): string {
  return resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));
}

export function hardflowHome(): string {
  return resolve(process.env.CODEX_HARDFLOW_HOME ?? join(homedir(), ".codex-hardflow"));
}

export function hardflowStateDir(): string {
  return join(hardflowHome(), "state");
}

export function privateStoreRoot(): string {
  return resolve(process.env.CODEX_HARDFLOW_PRIVATE_ROOT ?? join(homedir(), ".local", "share", "codex-hardflow", "private"));
}

export function repoHash(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
}

export function repoStateDir(cwd: string): string {
  return join(hardflowStateDir(), repoHash(cwd));
}

export function repoPrivateDir(cwd: string): string {
  return join(privateStoreRoot(), repoHash(cwd));
}

export function agentReportsDir(cwd: string): string {
  return join(resolve(cwd), ".agent", "reports");
}

export function agentManifestsDir(cwd: string): string {
  return join(resolve(cwd), ".agent", "manifests");
}

export function executorManifestPath(cwd: string): string {
  return join(agentManifestsDir(cwd), "executor_manifest.json");
}

export function validationSummaryPath(cwd: string): string {
  return join(agentReportsDir(cwd), "validation_summary.json");
}

export function researchReportPath(cwd: string): string {
  return join(agentReportsDir(cwd), "research_report.json");
}

export interface SkillPathStrategy {
  canonicalPath: string;
  legacyPath: string;
  canonicalExists: boolean;
  legacyExists: boolean;
  installAction: "install-canonical";
  discoverySmokeTest: "manual_required";
  note: string;
}

export function skillPathStrategy(): SkillPathStrategy {
  const canonicalPath = resolve(join(homedir(), ".agents", "skills", "codex-hardflow", "SKILL.md"));
  const legacyPath = resolve(join(codexHome(), "skills", "codex-hardflow", "SKILL.md"));
  return {
    canonicalPath,
    legacyPath,
    canonicalExists: existsSync(canonicalPath),
    legacyExists: existsSync(legacyPath),
    installAction: "install-canonical",
    discoverySmokeTest: "manual_required",
    note: "Install canonical ~/.agents/skills first. If interactive /skills proves this Codex build only recognizes ~/.codex/skills, ask before moving or symlinking to avoid duplicate active SKILL.md files."
  };
}
