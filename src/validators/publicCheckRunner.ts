import { spawnSync } from "node:child_process";

export function runPublicCheck(command: string, cwd: string): { command: string; status: "passed" | "failed"; output: string } {
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8", timeout: 120_000 });
  return {
    command,
    status: result.status === 0 ? "passed" : "failed",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, 4000)
  };
}
