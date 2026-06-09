import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cleanWorkspaceStrategy, hasHeadCommit } from "../src/gitUtils.js";

describe("git utils", () => {
  it("uses dry-run temp-copy fallback when repo has no HEAD commit", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-git-"));
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    expect(hasHeadCommit(cwd)).toBe(false);
    const strategy = cleanWorkspaceStrategy(cwd);
    expect(strategy.mode).toBe("temp-copy");
    expect(strategy.dryRunDefault).toBe(true);
  });
});
