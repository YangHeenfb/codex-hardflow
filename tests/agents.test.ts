import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installGlobalCustomAgents } from "../src/config.js";

describe("researcher agent definitions", () => {
  it("includes local_repo and competitor template TOML files", () => {
    const localRepoTemplate = join(process.cwd(), "src", "templates", "local_repo_researcher.toml");
    const competitorTemplate = join(process.cwd(), "src", "templates", "competitor_researcher.toml");

    expect(existsSync(localRepoTemplate)).toBe(true);
    expect(existsSync(competitorTemplate)).toBe(true);
    expect(readFileSync(localRepoTemplate, "utf8")).toContain("local_project_profile");
    expect(readFileSync(competitorTemplate, "utf8")).toContain("competitor_matrix");
  });

  it("installs local_repo_researcher and competitor_researcher globally", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "hardflow-codex-home-"));
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    try {
      const result = installGlobalCustomAgents();

      expect(result.files).toContain(join(codexHome, "agents", "local_repo_researcher.toml"));
      expect(result.files).toContain(join(codexHome, "agents", "competitor_researcher.toml"));
      expect(readFileSync(join(codexHome, "agents", "local_repo_researcher.toml"), "utf8")).toContain("local_project_profile");
      expect(readFileSync(join(codexHome, "agents", "competitor_researcher.toml"), "utf8")).toContain("competitor_matrix");
    } finally {
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
    }
  });
});
