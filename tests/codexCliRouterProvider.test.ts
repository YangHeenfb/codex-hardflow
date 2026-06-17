import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCodexCliRouterPrompt } from "../src/router/providers/codexCli.js";

describe("codex_cli router provider", () => {
  it("uses arguments supported by the current Codex exec CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hardflow-codex-cli-provider-"));
    const fakeCodex = join(dir, "codex");
    const argvPath = join(dir, "argv.txt");
    const envPath = join(dir, "env.txt");
    const sourceCodexHome = join(dir, "source-codex-home");
    const isolatedCodexHome = join(dir, "codex-home");
    mkdirSync(sourceCodexHome);
    writeFileSync(join(sourceCodexHome, "auth.json"), "{}\n");
    writeFileSync(join(sourceCodexHome, "hooks.json"), "{}\n");
    writeFileSync(
      fakeCodex,
      `#!/bin/sh
printf '%s\n' "$@" > "$CAPTURE_ARGV"
printf 'CODEX_HOME=%s\nCODEX_HARDFLOW_INTERNAL=%s\nCODEX_HARDFLOW_INTERNAL_PURPOSE=%s\n' "$CODEX_HOME" "$CODEX_HARDFLOW_INTERNAL" "$CODEX_HARDFLOW_INTERNAL_PURPOSE" > "$CAPTURE_ENV"
cat >/dev/null
printf '{"ok":true}'
`
    );
    chmodSync(fakeCodex, 0o755);
    process.env.CAPTURE_ARGV = argvPath;
    process.env.CAPTURE_ENV = envPath;
    process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME = sourceCodexHome;

    await runCodexCliRouterPrompt(
      { rawUserPrompt: "translate hello", currentRunId: "run-codex-cli-provider" },
      {
        cwd: dir,
        isolatedCodexHome,
        runId: "run-codex-cli-provider",
        codexCommand: fakeCodex
      }
    );

    const argv = readFileSync(argvPath, "utf8").trim().split("\n");
    expect(argv).toEqual(["exec", "--skip-git-repo-check", "--ignore-rules", "--sandbox", "read-only"]);
    expect(argv).not.toContain("-a");
    expect(argv).not.toContain("never");
    expect(readFileSync(envPath, "utf8")).toContain("CODEX_HARDFLOW_INTERNAL_PURPOSE=daemon_router");
    expect(readFileSync(join(isolatedCodexHome, "auth.json"), "utf8")).toBe("{}\n");

    delete process.env.CAPTURE_ARGV;
    delete process.env.CAPTURE_ENV;
    delete process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME;
  });
});
