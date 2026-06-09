import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { absoluteCommandFor, cliPathStatus, installShellWrapper, shellWrapperPath } from "../src/cliPaths.js";

describe("CLI path status and shell wrapper", () => {
  it("installs ~/.local/bin/codex-hardflow wrapper when missing", () => {
    const home = mkdtempSync(join(tmpdir(), "hardflow-home-"));
    const result = installShellWrapper(process.cwd(), home);

    expect(result.wrapperAvailable).toBe(true);
    expect(result.conflict).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.path).toBe(shellWrapperPath(home));
    expect(readFileSync(result.path, "utf8")).toContain(absoluteCommandFor(process.cwd()));
  });

  it("does not overwrite conflicting codex-hardflow wrapper", () => {
    const home = mkdtempSync(join(tmpdir(), "hardflow-home-"));
    const path = shellWrapperPath(home);
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(path, "#!/bin/sh\necho external\n");
    chmodSync(path, 0o755);

    const result = installShellWrapper(process.cwd(), home);

    expect(result.wrapperAvailable).toBe(false);
    expect(result.conflict).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("#!/bin/sh\necho external\n");
    const status = cliPathStatus(process.cwd(), { homeDir: home, appPathEnv: "", shellPathEnv: "" });
    expect(status.wrapperAvailable).toBe(false);
    expect(status.wrapperConflict).toBe(true);
  });

  it("distinguishes shell PATH from app PATH and still reports the absolute command", () => {
    const shellBin = mkdtempSync(join(tmpdir(), "hardflow-shell-bin-"));
    const shellCommand = join(shellBin, "codex-hardflow");
    writeFileSync(shellCommand, "#!/bin/sh\nexit 0\n");
    chmodSync(shellCommand, 0o755);

    const status = cliPathStatus(process.cwd(), {
      appPathEnv: "",
      shellPathEnv: shellBin,
      homeDir: mkdtempSync(join(tmpdir(), "hardflow-home-"))
    });

    expect(status.shellPathAvailable).toBe(true);
    expect(status.appPathAvailable).toBe(false);
    expect(status.absoluteCommand).toBe(resolve(process.cwd(), "bin", "codex-hardflow"));
  });
});
