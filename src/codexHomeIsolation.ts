import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function sourceCodexHome(): string {
  return resolve(process.env.CODEX_HARDFLOW_SOURCE_CODEX_HOME ?? join(homedir(), ".codex"));
}

function copyIfPresent(source: string, target: string): void {
  if (!existsSync(source) || resolve(source) === resolve(target)) return;
  copyFileSync(source, target);
  chmodSync(target, 0o600);
}

export function prepareIsolatedCodexHome(codexHome: string): string {
  mkdirSync(codexHome, { recursive: true });
  for (const forbidden of ["hooks.json", "AGENTS.md"]) {
    const target = join(codexHome, forbidden);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  copyIfPresent(join(sourceCodexHome(), "auth.json"), join(codexHome, "auth.json"));
  return codexHome;
}
