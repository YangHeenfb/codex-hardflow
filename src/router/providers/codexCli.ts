import { existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { buildRouterPrompt } from "../routerPrompt.js";
import type { RouterInput } from "../routerSchema.js";
import { internalEnvFor } from "../../internalEnv.js";

export interface CodexCliRouterOptions {
  cwd: string;
  isolatedCodexHome: string;
  runId: string;
  timeoutMs?: number;
  codexCommand?: string;
}

export function prepareIsolatedCodexHome(codexHome: string): string {
  mkdirSync(codexHome, { recursive: true });
  for (const forbidden of ["hooks.json", "AGENTS.md"]) {
    const target = `${codexHome}/${forbidden}`;
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(dirname(codexHome), { recursive: true });
  return codexHome;
}

function sanitizeOutput(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 4000);
}

export async function runCodexCliRouterPrompt(input: RouterInput, options: CodexCliRouterOptions): Promise<string> {
  const prompt = buildRouterPrompt(input);
  prepareIsolatedCodexHome(options.isolatedCodexHome);
  const env = internalEnvFor(
    {
      ...process.env,
      CODEX_HOME: options.isolatedCodexHome
    },
    "daemon_router",
    options.runId
  );
  const result = spawnSync(options.codexCommand ?? "codex", ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-a", "never"], {
    cwd: options.cwd,
    env,
    input: prompt,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 45_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codex_cli router exited with status ${result.status ?? "unknown"}: ${sanitizeOutput(result.stderr ?? result.stdout ?? "")}`);
  }
  return result.stdout ?? "";
}
