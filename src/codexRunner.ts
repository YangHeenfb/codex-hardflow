import { Codex, Thread } from "@openai/codex-sdk";
import { SDK_VERSION } from "./config.js";
import { withHardflowInternalEnvSync, type HardflowInternalPurpose } from "./internalEnv.js";

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

export async function runIsolatedCodexPrompt(
  prompt: string,
  cwd: string,
  readOnly = true,
  internal: { purpose: HardflowInternalPurpose; parentRunId: string } = { purpose: "router", parentRunId: "router" }
): Promise<string> {
  const resultPromise = withHardflowInternalEnvSync(internal.purpose, internal.parentRunId, () => {
    const codex = new Codex();
    const thread = codex.startThread({
      workingDirectory: cwd,
      sandboxMode: readOnly ? "read-only" : "workspace-write",
      webSearchMode: "live",
      approvalPolicy: "never"
    });
    return thread.run(prompt);
  });
  const result = await resultPromise;
  return result.finalResponse;
}
