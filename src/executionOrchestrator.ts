import { existsSync, readFileSync } from "node:fs";
import { HardflowError } from "./errors.js";
import { executorManifestPath } from "./paths.js";
import type { ExecutorManifest } from "./schemas.js";

export function readExecutorManifest(cwd: string): ExecutorManifest {
  const target = executorManifestPath(cwd);
  if (!existsSync(target)) {
    throw new HardflowError("executor_manifest.json is required before hidden validation.", "EXECUTOR_MANIFEST_MISSING");
  }
  return JSON.parse(readFileSync(target, "utf8")) as ExecutorManifest;
}

export function requireExecutorManifest(cwd: string): void {
  readExecutorManifest(cwd);
}
