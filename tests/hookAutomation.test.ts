import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultRoutePreflightRunner, defaultStrictResearchRunner } from "../src/hooks/hookAutomation.js";
import { researchRunHookInputPath } from "../src/paths.js";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hardflow-hook-automation-"));
  mkdirSync(join(dir, ".agent", "reports"), { recursive: true });
  return dir;
}

function writeFakeCommand(cwd: string, output: Record<string, unknown>): { command: string; envPath: string } {
  const command = join(cwd, "fake-command.js");
  const envPath = join(cwd, "internal-env.json");
  writeFileSync(
    command,
    `#!/usr/bin/env node
const fs = require("fs");
fs.writeFileSync(${JSON.stringify(envPath)}, JSON.stringify({
  internal: process.env.CODEX_HARDFLOW_INTERNAL,
  purpose: process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE,
  parentRunId: process.env.CODEX_HARDFLOW_PARENT_RUN_ID,
  depth: process.env.CODEX_HARDFLOW_INTERNAL_DEPTH,
  argv: process.argv.slice(2)
}, null, 2));
console.log(JSON.stringify(${JSON.stringify(output)}));
`
  );
  chmodSync(command, 0o755);
  return { command, envPath };
}

describe("hook automation internal execution", () => {
  function clearInternalEnv(): void {
    delete process.env.CODEX_HARDFLOW_INTERNAL;
    delete process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE;
    delete process.env.CODEX_HARDFLOW_PARENT_RUN_ID;
    delete process.env.CODEX_HARDFLOW_INTERNAL_DEPTH;
  }

  beforeEach(clearInternalEnv);
  afterEach(clearInternalEnv);

  it("sets internal env and uses input-json for route preflight", () => {
    const cwd = tempRepo();
    const prompt = `agent memory ${"x".repeat(10_000)}`;
    const { command, envPath } = writeFakeCommand(cwd, { route: "direct_answer" });

    const result = defaultRoutePreflightRunner({ cwd, command, runId: "run-route-env", rawUserPrompt: prompt, timeoutMs: 1000, turnId: "turn-route-env" });
    const env = JSON.parse(readFileSync(envPath, "utf8")) as Record<string, unknown>;
    const inputPath = researchRunHookInputPath(cwd, "run-route-env");
    const input = JSON.parse(readFileSync(inputPath, "utf8")) as Record<string, unknown>;

    expect(result.succeeded).toBe(true);
    expect(env.internal).toBe("1");
    expect(env.purpose).toBe("router");
    expect(env.parentRunId).toBe("run-route-env");
    expect(env.depth).toBe("1");
    expect(result.command).toContain("--input-json");
    expect(result.command).not.toContain(prompt.slice(0, 1000));
    expect(input.rawUserPrompt).toBe(prompt);
    expect(existsSync(inputPath)).toBe(true);
  });

  it("sets internal env and uses input-json for strict research auto-run", () => {
    const cwd = tempRepo();
    const { command, envPath } = writeFakeCommand(cwd, { status: "completed", runId: "run-strict-env" });

    const result = defaultStrictResearchRunner({ cwd, command, runId: "run-strict-env", rawUserPrompt: "research current agent memory", timeoutMs: 1000, turnId: "turn-strict-env" });
    const env = JSON.parse(readFileSync(envPath, "utf8")) as Record<string, unknown>;

    expect(result.succeeded).toBe(true);
    expect(env.internal).toBe("1");
    expect(env.purpose).toBe("strict_research");
    expect(env.parentRunId).toBe("run-strict-env");
    expect(env.depth).toBe("1");
    expect(result.command).toContain("--input-json");
    expect(result.command).not.toContain("research current agent memory");
  });

  it("fails fast when internal recursion depth would exceed the limit", () => {
    const cwd = tempRepo();
    const { command } = writeFakeCommand(cwd, { route: "direct_answer" });
    process.env.CODEX_HARDFLOW_INTERNAL = "1";
    process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE = "router";
    process.env.CODEX_HARDFLOW_PARENT_RUN_ID = "run-parent";
    process.env.CODEX_HARDFLOW_INTERNAL_DEPTH = "3";

    const result = defaultRoutePreflightRunner({ cwd, command, runId: "run-depth", rawUserPrompt: "prompt", timeoutMs: 1000 });

    expect(result.succeeded).toBe(false);
    expect(result.failureReason).toContain("internal_recursion_limit");
  });
});
