import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { status } from "../src/cli.js";
import {
  disableGlobalSkill,
  globalAgentsMdHasHardflowBlock,
  installGlobalAgentsMdDocs,
  installGlobalSkill,
  removeGlobalAgentsMdBlock,
  resolveInstallGlobalOptions
} from "../src/config.js";

function withEnv<T>(env: Record<string, string>, run: () => T): T {
  const originals = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) originals.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    return run();
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("install-global strict strategy", () => {
  it("keeps repository AGENTS.md free of hardflow protocol terms", () => {
    const agents = readFileSync(join(process.cwd(), "AGENTS.md"), "utf8").toLowerCase();
    const forbiddenTerms = [
      "hardflow",
      "codex-hardflow",
      "strict_programmatic",
      "app_handoff",
      "router_trace",
      "coveragemode",
      "source coverage matrix",
      "evidenceledger",
      "sdk_worker",
      "userpromptsubmit",
      "stop gate",
      "hidden validator protocol",
      "researchrequest",
      "parallelpolicy"
    ];

    for (const term of forbiddenTerms) {
      expect(agents).not.toContain(term);
    }
  });

  it("defaults install-global to strict programmatic mode without docs, skills, or App agents", () => {
    expect(resolveInstallGlobalOptions()).toEqual({
      mode: "strict",
      withSkill: false,
      withAppAgents: false,
      withAgentsDocs: false
    });
    expect(resolveInstallGlobalOptions({ mode: "assisted" })).toEqual({
      mode: "assisted",
      withSkill: true,
      withAppAgents: true,
      withAgentsDocs: true
    });
    expect(resolveInstallGlobalOptions({ mode: "strict", withSkill: true })).toMatchObject({
      mode: "strict",
      withSkill: true,
      withAppAgents: false,
      withAgentsDocs: false
    });
  });

  it("removes the old global AGENTS hardflow block instead of installing it by default", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "hardflow-install-codex-home-"));
    withEnv({ CODEX_HOME: codexHome }, () => {
      const target = join(codexHome, "AGENTS.md");
      writeFileSync(target, "General user instructions.\n\n# Global Codex Hardflow Protocol\nold block\n");

      const result = removeGlobalAgentsMdBlock();

      expect(result.removed).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(globalAgentsMdHasHardflowBlock()).toBe(false);
      expect(readFileSync(target, "utf8")).toBe("General user instructions.\n");
    });
  });

  it("writes global AGENTS docs only when the opt-in docs installer is called", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "hardflow-install-agents-docs-"));
    withEnv({ CODEX_HOME: codexHome }, () => {
      expect(globalAgentsMdHasHardflowBlock()).toBe(false);

      installGlobalAgentsMdDocs(process.cwd());

      expect(globalAgentsMdHasHardflowBlock()).toBe(true);
      expect(readFileSync(join(codexHome, "AGENTS.md"), "utf8")).toContain("# Global Codex Hardflow Protocol");
    });
  });

  it("does not leave an active codex-hardflow skill in strict mode unless requested", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "hardflow-install-codex-home-"));
    const skillRoot = mkdtempSync(join(tmpdir(), "hardflow-install-skills-"));
    withEnv({ CODEX_HOME: codexHome, CODEX_HARDFLOW_SKILL_ROOT: skillRoot }, () => {
      const canonical = join(skillRoot, "codex-hardflow", "SKILL.md");
      const legacy = join(codexHome, "skills", "codex-hardflow", "SKILL.md");
      mkdirSync(join(skillRoot, "codex-hardflow"), { recursive: true });
      mkdirSync(join(codexHome, "skills", "codex-hardflow"), { recursive: true });
      writeFileSync(canonical, "active canonical skill\n");
      writeFileSync(legacy, "active legacy skill\n");

      const disabled = disableGlobalSkill();

      expect(disabled.disabled).toBe(true);
      expect(disabled.disabledPaths.sort()).toEqual([canonical, legacy].sort());
      expect(existsSync(canonical)).toBe(false);
      expect(existsSync(legacy)).toBe(false);
      expect(disabled.backupPaths.every((path) => existsSync(path))).toBe(true);

      const installed = installGlobalSkill(process.cwd());

      expect(installed.path).toBe(canonical);
      expect(existsSync(canonical)).toBe(true);
    });
  });

  it("status reports active skills, global AGENTS blocks, and strict install state", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "hardflow-status-codex-home-"));
    const skillRoot = mkdtempSync(join(tmpdir(), "hardflow-status-skills-"));
    const hardflowHome = mkdtempSync(join(tmpdir(), "hardflow-status-home-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hardflow-status-private-"));
    withEnv(
      {
        CODEX_HOME: codexHome,
        CODEX_HARDFLOW_SKILL_ROOT: skillRoot,
        CODEX_HARDFLOW_HOME: hardflowHome,
        CODEX_HARDFLOW_PRIVATE_ROOT: privateRoot
      },
      () => {
        mkdirSync(codexHome, { recursive: true });
        writeFileSync(join(codexHome, "hooks.json"), "{}\n");

        const clean = status(process.cwd(), process.cwd());
        expect(clean.activeSkillInstalled).toBe(false);
        expect(clean.hardflowAgentsMdBlockInstalled).toBe(false);
        expect(clean.strictProgrammaticInstall).toBe(true);

        installGlobalAgentsMdDocs(process.cwd());
        installGlobalSkill(process.cwd());
        const assisted = status(process.cwd(), process.cwd());

        expect(assisted.activeSkillInstalled).toBe(true);
        expect(assisted.hardflowAgentsMdBlockInstalled).toBe(true);
        expect(assisted.strictProgrammaticInstall).toBe(false);
      }
    );
  });
});
