import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { HardflowError } from "./errors.js";
import { repoPrivateDir } from "./paths.js";

export function assertOutsideRepo(candidatePath: string, repoPath: string): void {
  const candidate = resolve(candidatePath);
  const repo = resolve(repoPath);
  const rel = relative(repo, candidate);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) {
    throw new HardflowError("Private store must not be inside the repository.", "PRIVATE_STORE_INSIDE_REPO");
  }
}

export function ensureRepoPrivateStore(cwd: string): string {
  const privateDir = repoPrivateDir(cwd);
  assertOutsideRepo(privateDir, cwd);
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  return privateDir;
}

export function writePrivateJson(cwd: string, fileName: string, data: unknown): string {
  const dir = ensureRepoPrivateStore(cwd);
  const target = resolve(dir, fileName);
  assertOutsideRepo(target, cwd);
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return target;
}

export function readPrivateJson<T>(cwd: string, fileName: string, fallback: T): T {
  const dir = ensureRepoPrivateStore(cwd);
  const target = resolve(dir, fileName);
  if (!existsSync(target)) return fallback;
  return JSON.parse(readFileSync(target, "utf8")) as T;
}
