import { spawn } from "node:child_process";
import { buildRouterPrompt } from "../routerPrompt.js";
import type { RouterInput } from "../routerSchema.js";
import { internalEnvFor } from "../../internalEnv.js";
import { prepareIsolatedCodexHome } from "../../codexHomeIsolation.js";

export { prepareIsolatedCodexHome };

export interface CodexCliRouterOptions {
  cwd: string;
  isolatedCodexHome: string;
  runId: string;
  timeoutMs?: number;
  codexCommand?: string;
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
  const result = await runCodexCliProcess(options.codexCommand ?? "codex", prompt, {
    cwd: options.cwd,
    env,
    timeoutMs: options.timeoutMs ?? 45_000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`codex_cli router exited with status ${result.status ?? "unknown"}: ${sanitizeOutput(result.stderr || result.stdout)}`);
  }
  return result.stdout;
}

async function runCodexCliProcess(
  command: string,
  input: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; maxBuffer: number }
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["exec", "--skip-git-repo-check", "--ignore-rules", "--sandbox", "read-only"], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (stdout.length + stderr.length > options.maxBuffer) {
        child.kill("SIGTERM");
        fail(new Error(`codex_cli router exceeded max output buffer: ${options.maxBuffer}`));
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", fail);
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`codex_cli router timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
