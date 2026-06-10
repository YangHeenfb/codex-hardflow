import { accessSync, chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface ShellWrapperStatus {
  path: string;
  target: string;
  actualTarget: string | null;
  wrapperAvailable: boolean;
  conflict: boolean;
  installed: boolean;
  reason: string;
  backupPath?: string;
  overwritten?: boolean;
  warning?: string;
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
  globalWrapperPath: string;
  globalWrapperTarget: string | null;
  wrapperPointsToCurrentSourceRoot: boolean;
  wrapperVersion: string | null;
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

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function extractManagedWrapperTarget(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return resolve(dirname(path), readlinkSync(path));
  if (!stat.isFile()) return null;
  const content = readFileSync(path, "utf8");
  const match = content.match(/^#!\/bin\/sh\nexec '(.+)' "\$@"\n$/);
  if (!match) return null;
  return match[1]?.replace(/'\\''/g, "'") ?? null;
}

function sourceRootFromWrapperTarget(target: string | null): string | null {
  if (!target) return null;
  const resolved = resolve(target);
  if (!resolved.endsWith(`${"/bin"}/codex-hardflow`)) return null;
  return dirname(dirname(resolved));
}

function wrapperVersionForTarget(target: string | null): string | null {
  const root = sourceRootFromWrapperTarget(target);
  if (!root) return null;
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export function inspectShellWrapper(sourceRoot: string, homeDir = homedir()): ShellWrapperStatus {
  const target = absoluteCommandFor(sourceRoot);
  const path = shellWrapperPath(homeDir);
  if (!existsSync(path)) {
    return { path, target, actualTarget: null, wrapperAvailable: false, conflict: false, installed: false, reason: "missing" };
  }
  const actualTarget = extractManagedWrapperTarget(path);
  if (wrapperMatches(path, target)) {
    return { path, target, actualTarget: actualTarget ?? target, wrapperAvailable: isExecutable(path), conflict: false, installed: false, reason: "present" };
  }
  if (actualTarget && sourceRootFromWrapperTarget(actualTarget)) {
    return {
      path,
      target,
      actualTarget,
      wrapperAvailable: isExecutable(path),
      conflict: false,
      installed: false,
      reason: "stale-managed-wrapper",
      warning: `global wrapper points to ${actualTarget}, not ${target}`
    };
  }
  return { path, target, actualTarget, wrapperAvailable: false, conflict: true, installed: false, reason: "existing codex-hardflow is not managed by this install" };
}

export function installShellWrapper(sourceRoot: string, homeDir = homedir()): ShellWrapperStatus {
  const target = absoluteCommandFor(sourceRoot);
  const path = shellWrapperPath(homeDir);
  const before = inspectShellWrapper(sourceRoot, homeDir);
  if (before.conflict) return before;
  if (before.reason === "present" && before.wrapperAvailable) return before;

  mkdirSync(dirname(path), { recursive: true });
  let backupPath: string | undefined;
  if (existsSync(path)) {
    backupPath = `${path}.bak.${timestamp()}`;
    copyFileSync(path, backupPath);
  }
  writeFileSync(path, wrapperContent(target));
  chmodSync(path, 0o755);
  return { path, target, actualTarget: target, wrapperAvailable: true, conflict: false, installed: true, reason: before.reason === "stale-managed-wrapper" ? "updated-stale-managed-wrapper" : "installed", backupPath, overwritten: Boolean(backupPath) };
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
  const wrapperSourceRoot = sourceRootFromWrapperTarget(wrapper.actualTarget);
  return {
    absoluteCliAvailable: isExecutable(absoluteCommand),
    wrapperAvailable: wrapper.wrapperAvailable,
    wrapperConflict: wrapper.conflict,
    shellPathAvailable: shellPathResolved !== null,
    appPathAvailable: appPathResolved !== null,
    absoluteCommand,
    wrapperPath: wrapper.path,
    shellPathResolved,
    appPathResolved,
    globalWrapperPath: wrapper.path,
    globalWrapperTarget: wrapper.actualTarget,
    wrapperPointsToCurrentSourceRoot: wrapperSourceRoot !== null && resolve(wrapperSourceRoot) === resolve(sourceRoot),
    wrapperVersion: wrapperVersionForTarget(wrapper.actualTarget)
  };
}
