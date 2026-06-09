import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface ShellWrapperStatus {
  path: string;
  target: string;
  wrapperAvailable: boolean;
  conflict: boolean;
  installed: boolean;
  reason: string;
}

export interface CliPathStatus {
  absoluteCliAvailable: boolean;
  wrapperAvailable: boolean;
  wrapperConflict: boolean;
  shellPathAvailable: boolean;
  appPathAvailable: boolean;
  absoluteCommand: string;
  wrapperPath: string;
  shellPathResolved: string | null;
  appPathResolved: string | null;
}

export interface CliPathStatusOptions {
  appPathEnv?: string;
  shellPathEnv?: string;
  homeDir?: string;
  shell?: string;
}

export function absoluteCommandFor(sourceRoot: string): string {
  return resolve(sourceRoot, "bin", "codex-hardflow");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function wrapperContent(target: string): string {
  return `#!/bin/sh\nexec ${shellQuote(target)} "$@"\n`;
}

export function shellWrapperPath(homeDir = homedir()): string {
  return join(homeDir, ".local", "bin", "codex-hardflow");
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function wrapperMatches(path: string, target: string): boolean {
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    return resolve(dirname(path), readlinkSync(path)) === resolve(target);
  }
  if (!stat.isFile()) return false;
  return readFileSync(path, "utf8") === wrapperContent(target);
}

export function inspectShellWrapper(sourceRoot: string, homeDir = homedir()): ShellWrapperStatus {
  const target = absoluteCommandFor(sourceRoot);
  const path = shellWrapperPath(homeDir);
  if (!existsSync(path)) {
    return { path, target, wrapperAvailable: false, conflict: false, installed: false, reason: "missing" };
  }
  if (wrapperMatches(path, target)) {
    return { path, target, wrapperAvailable: isExecutable(path), conflict: false, installed: false, reason: "present" };
  }
  return { path, target, wrapperAvailable: false, conflict: true, installed: false, reason: "existing codex-hardflow is not managed by this install" };
}

export function installShellWrapper(sourceRoot: string, homeDir = homedir()): ShellWrapperStatus {
  const target = absoluteCommandFor(sourceRoot);
  const path = shellWrapperPath(homeDir);
  const before = inspectShellWrapper(sourceRoot, homeDir);
  if (before.conflict) return before;
  if (before.wrapperAvailable) return before;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, wrapperContent(target));
  chmodSync(path, 0o755);
  return { path, target, wrapperAvailable: true, conflict: false, installed: true, reason: "installed" };
}

export function resolveCommandOnPath(command: string, pathEnv: string): string | null {
  for (const rawDir of pathEnv.split(delimiter)) {
    const dir = rawDir.trim();
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate) && isExecutable(candidate)) return candidate;
  }
  return null;
}

function shellResolvedCommand(command: string, options: CliPathStatusOptions): string | null {
  if (options.shellPathEnv !== undefined) {
    return resolveCommandOnPath(command, options.shellPathEnv);
  }
  const shell = options.shell ?? process.env.SHELL ?? "/bin/sh";
  const result = spawnSync(shell, ["-lc", `command -v ${command}`], {
    encoding: "utf8",
    timeout: 5_000
  });
  const resolved = result.status === 0 ? result.stdout.trim().split("\n")[0] : "";
  return resolved || null;
}

export function cliPathStatus(sourceRoot: string, options: CliPathStatusOptions = {}): CliPathStatus {
  const absoluteCommand = absoluteCommandFor(sourceRoot);
  const wrapper = inspectShellWrapper(sourceRoot, options.homeDir);
  const appPathResolved = resolveCommandOnPath("codex-hardflow", options.appPathEnv ?? process.env.PATH ?? "");
  const shellPathResolved = shellResolvedCommand("codex-hardflow", options);
  return {
    absoluteCliAvailable: isExecutable(absoluteCommand),
    wrapperAvailable: wrapper.wrapperAvailable,
    wrapperConflict: wrapper.conflict,
    shellPathAvailable: shellPathResolved !== null,
    appPathAvailable: appPathResolved !== null,
    absoluteCommand,
    wrapperPath: wrapper.path,
    shellPathResolved,
    appPathResolved
  };
}
