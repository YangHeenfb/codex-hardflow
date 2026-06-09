import { Codex, Thread } from "@openai/codex-sdk";
import { SDK_VERSION } from "./config.js";

export interface CodexRunnerStatus {
  sdkVersion: string;
  codexExportAvailable: boolean;
  threadExportAvailable: boolean;
}

export function codexRunnerStatus(): CodexRunnerStatus {
  return {
    sdkVersion: SDK_VERSION,
    codexExportAvailable: typeof Codex === "function",
    threadExportAvailable: typeof Thread === "function"
  };
}

export async function runIsolatedCodexPrompt(prompt: string, cwd: string, readOnly = true): Promise<string> {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: cwd,
    sandboxMode: readOnly ? "read-only" : "workspace-write",
    webSearchMode: "live",
    approvalPolicy: "never"
  });
  const result = await thread.run(prompt);
  return result.finalResponse;
}
