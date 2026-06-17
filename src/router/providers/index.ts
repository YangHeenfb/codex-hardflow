import type { HardflowRouterProvider } from "../../jobs/jobSchema.js";
import type { RouterInput, RouterOutput, RouterTrace } from "../routerSchema.js";
import { runLlmRouter } from "../llmRouter.js";
import { runCodexCliRouterPrompt } from "./codexCli.js";
import { runIsolatedCodexPrompt } from "../../codexRunner.js";

export interface RouterProviderContext {
  cwd: string;
  runId: string;
  turnId: string;
  isolatedCodexHome: string;
  timeoutMs?: number;
  codexCommand?: string;
  mockOutput?: RouterOutput;
}

export async function runRouterProvider(
  provider: HardflowRouterProvider,
  input: RouterInput,
  context: RouterProviderContext
): Promise<{ output: RouterOutput; trace: RouterTrace }> {
  if (provider === "mock") {
    if (!context.mockOutput) throw new Error("mock router provider requires mockOutput.");
    return runLlmRouter(input, {
      cwd: context.cwd,
      turnId: context.turnId,
      writeTrace: true,
      triggerSource: input.triggerSource,
      programmaticTrigger: input.programmaticTrigger,
      promptRunner: async () => JSON.stringify(context.mockOutput)
    });
  }
  if (provider === "codex_cli") {
    return runLlmRouter(input, {
      cwd: context.cwd,
      turnId: context.turnId,
      timeoutMs: context.timeoutMs,
      writeTrace: true,
      triggerSource: input.triggerSource,
      programmaticTrigger: input.programmaticTrigger,
      promptRunner: async (_prompt, cwd) =>
        runCodexCliRouterPrompt(input, {
          cwd,
          runId: context.runId,
          isolatedCodexHome: context.isolatedCodexHome,
          timeoutMs: context.timeoutMs,
          codexCommand: context.codexCommand
        })
    });
  }
  if (provider === "codex_sdk") {
    return runLlmRouter(input, {
      cwd: context.cwd,
      turnId: context.turnId,
      timeoutMs: context.timeoutMs,
      writeTrace: true,
      triggerSource: input.triggerSource,
      programmaticTrigger: input.programmaticTrigger,
      promptRunner: async (prompt, cwd) => {
        const previous = process.env.CODEX_HOME;
        process.env.CODEX_HOME = context.isolatedCodexHome;
        try {
          return await runIsolatedCodexPrompt(prompt, cwd, true, {
            purpose: "daemon_router",
            parentRunId: context.runId
          });
        } finally {
          if (previous === undefined) delete process.env.CODEX_HOME;
          else process.env.CODEX_HOME = previous;
        }
      }
    });
  }
  throw new Error(`${provider} router provider is not implemented in local daemon mode.`);
}
