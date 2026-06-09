import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative, join } from "node:path";
import { spawnSync } from "node:child_process";

export function gitRoot(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function hasHeadCommit(cwd: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0;
}

export function gitStatusShort(cwd: string): string[] {
  const result = spawnSync("git", ["status", "--short"], { cwd, encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split("\n").map((line) => line.trimEnd()).filter(Boolean);
}

export function normalizeScope(scope: string, cwd: string): string {
  const normalized = resolve(cwd, scope);
  const rel = relative(resolve(cwd), normalized);
  return rel === "" ? "." : rel.replace(/\\/g, "/");
}

export function scopesOverlap(a: string, b: string, cwd: string): boolean {
  const left = normalizeScope(a, cwd);
  const right = normalizeScope(b, cwd);
  if (left === "." || right === ".") return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function findPathScopeOverlaps(modules: Array<{ id: string; path_scope: string[] }>, cwd: string): Array<{ a: string; b: string; path: string }> {
  const overlaps: Array<{ a: string; b: string; path: string }> = [];
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      for (const left of modules[i]?.path_scope ?? []) {
        for (const right of modules[j]?.path_scope ?? []) {
          if (scopesOverlap(left, right, cwd)) {
            overlaps.push({ a: modules[i]?.id ?? String(i), b: modules[j]?.id ?? String(j), path: `${left} <-> ${right}` });
          }
        }
      }
    }
  }
  return overlaps;
}

export function cleanWorkspaceStrategy(cwd: string): { mode: "git-worktree" | "temp-copy"; dryRunDefault: boolean; reason: string } {
  if (hasHeadCommit(cwd)) {
    return { mode: "git-worktree", dryRunDefault: false, reason: "HEAD exists, so git worktree can be used for isolated workers." };
  }
  return { mode: "temp-copy", dryRunDefault: true, reason: "No HEAD commit exists. Worktree parallelism is disabled until an initial commit is created." };
}

export function createTempCopy(cwd: string): string {
  const target = mkdtempSync(join(tmpdir(), "codex-hardflow-workspace-"));
  cpSync(cwd, target, {
    recursive: true,
    filter: (source) => !source.includes(`${resolve(cwd, ".git")}`)
  });
  return target;
}
