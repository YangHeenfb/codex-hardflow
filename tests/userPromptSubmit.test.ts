import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readHookEvents } from "../src/hookEvents.js";
import { markerPathFor } from "../src/hookState.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { readHardflowJob } from "../src/jobs/jobStore.js";
import { hardflowJobPath, repoHash, researchRunHookInputPath, researchRunRouterTracePath } from "../src/paths.js";

function additionalContext(result: Record<string, unknown>): string {
  return String((result.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext ?? "");
}

describe("UserPromptSubmit job enqueue", () => {
  function tempRepo(): string {
    return mkdtempSync(join(tmpdir(), "hardflow-userprompt-"));
  }

  function clearInternalEnv(): void {
    delete process.env.CODEX_HARDFLOW_INTERNAL;
    delete process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE;
    delete process.env.CODEX_HARDFLOW_PARENT_RUN_ID;
    delete process.env.CODEX_HARDFLOW_INTERNAL_DEPTH;
  }

  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
    clearInternalEnv();
  });
  afterEach(clearInternalEnv);

  it("queues a HardFlow job without running router preflight", () => {
    const cwd = tempRepo();
    let routeCalls = 0;
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "What are current best practices for AI agent framework evaluation?",
        turnId: "turn-userprompt-research"
      },
      process.cwd(),
      {
        routeRunner: () => {
          routeCalls += 1;
          throw new Error("route runner should not be called from UserPromptSubmit");
        }
      }
    );
    const job = readHardflowJob(cwd, "run-turn-userprompt-research");

    expect(result.decision).toBe("allow");
    expect((result.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(result).not.toHaveProperty("additionalContext");
    expect(routeCalls).toBe(0);
    expect(job?.status).toBe("pending");
    expect(job?.routerProvider).toBe("codex_cli");
    expect(job?.workerProvider).toBe("codex_sdk");
    expect(job?.coverageMode).toBe("exhaustive");
    expect(job?.parallelPolicy).toBe("all_required");
    expect(additionalContext(result)).toContain("queued a HardFlow job");
    expect(additionalContext(result)).toContain("router_trace");
    expect(additionalContext(result)).toContain("official_docs_researcher");
    expect(additionalContext(result)).toContain("codex_default_researcher");
    expect(additionalContext(result)).toContain("jobs run-once --run-id run-turn-userprompt-research");
    expect(additionalContext(result)).toContain("daemon run");
    expect(additionalContext(result)).toContain("--input-json");
    expect(additionalContext(result)).not.toContain("--raw-user-prompt");
    expect(additionalContext(result)).not.toContain("research --runner app_handoff");
    expect(additionalContext(result)).toContain("--run-id");
    expect(additionalContext(result)).toContain("runs/");
    expect(additionalContext(result)).toContain("App subagents remain best-effort");
    expect(additionalContext(result)).not.toContain("node --import tsx");
    expect(additionalContext(result)).not.toContain("npx tsx src/cli.ts");
  });

  it("writes marker, hook_input, and job but no router_trace", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-userprompt-route-"));
    userPromptSubmit(
      {
        cwd,
        prompt: "What are current practical solutions for agent memory?",
        turnId: "turn-direct-route"
      },
      process.cwd()
    );
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-direct-route"), "utf8")) as Record<string, unknown>;
    const job = readHardflowJob(cwd, String(marker.runId));

    expect(marker.routeStatus).toBe("router_required");
    expect(job?.status).toBe("pending");
    expect(job?.triggerSource).toBe("hook_user_prompt_submit");
    expect(existsSync(hardflowJobPath(cwd, String(marker.runId)))).toBe(true);
    expect(existsSync(researchRunRouterTracePath(cwd, String(marker.runId)))).toBe(false);
    expect(existsSync(researchRunHookInputPath(cwd, String(marker.runId)))).toBe(true);
  });

  it("bypasses routing for internal SDK/router prompts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-userprompt-internal-"));
    process.env.CODEX_HARDFLOW_INTERNAL = "1";
    process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE = "router";
    process.env.CODEX_HARDFLOW_PARENT_RUN_ID = "run-parent";
    process.env.CODEX_HARDFLOW_INTERNAL_DEPTH = "1";

    const result = userPromptSubmit(
      {
        cwd,
        prompt: "You are the codex-hardflow structured task router. Return JSON only.",
        turnId: "turn-internal-router"
      },
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    expect((result.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmitInternalBypass");
    expect(existsSync(markerPathFor(repoHash(cwd), "turn-internal-router"))).toBe(false);
    const events = readHookEvents(cwd, "run-parent");
    expect(events.some((event) => event.eventName === "UserPromptSubmitInternalBypass" && event.internalPurpose === "router")).toBe(true);
  });

  it("keeps long raw prompts out of generated argv commands", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-userprompt-long-"));
    const longPrompt = `agent long horizon记忆管理方面现在有什么前沿方案？ ${"x".repeat(100_000)}`;
    const result = userPromptSubmit(
      {
        cwd,
        prompt: longPrompt,
        turnId: "turn-long-prompt"
      },
      process.cwd()
    );
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-long-prompt"), "utf8")) as Record<string, unknown>;
    const input = JSON.parse(readFileSync(researchRunHookInputPath(cwd, String(marker.runId)), "utf8")) as Record<string, unknown>;
    const job = readHardflowJob(cwd, String(marker.runId));

    expect(input.rawUserPrompt).toBe(longPrompt);
    expect(job?.rawUserPrompt).toBe(longPrompt);
    expect(additionalContext(result)).toContain("--input-json");
    expect(additionalContext(result)).not.toContain(longPrompt.slice(0, 1000));
    expect(additionalContext(result).length).toBeLessThan(20_000);
  });

  it("queues programmatically without AGENTS.md or skill guidance", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-userprompt-no-agents-"));
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "What are current practical solutions for agent memory?",
        turnId: "turn-no-agents-or-skill"
      },
      process.cwd()
    );
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-no-agents-or-skill"), "utf8")) as Record<string, unknown>;
    const job = readHardflowJob(cwd, String(marker.runId));

    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(result.decision).toBe("allow");
    expect(marker.triggerSource).toBe("hook_user_prompt_submit");
    expect(marker.programmaticTrigger).toBe(true);
    expect(marker.routeStatus).toBe("router_required");
    expect(job?.status).toBe("pending");
    expect(existsSync(researchRunRouterTracePath(cwd, String(marker.runId)))).toBe(false);
    expect(additionalContext(result)).toContain("HardFlow job path");
  });

  it("does not mark router_failed from UserPromptSubmit because route runs in daemon", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-userprompt-route-fail-"));
    let routeCalls = 0;
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "What are current practical solutions for agent memory?",
        turnId: "turn-direct-route-failed"
      },
      process.cwd(),
      {
        routeRunner: () => {
          routeCalls += 1;
          throw new Error("not called");
        }
      }
    );
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-direct-route-failed"), "utf8")) as Record<string, unknown>;

    expect(routeCalls).toBe(0);
    expect(marker.routeStatus).toBe("router_required");
    expect(additionalContext(result)).toContain("queued a HardFlow job");
  });

  it("includes local_repo and competitor researcher names in queued-job context", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "我现在这个项目做的multi agent结构有什么类似的产品或者项目？有哪些我可以吸收改进的？",
        turnId: "turn-userprompt-local-competitors"
      },
      process.cwd()
    );

    expect(additionalContext(result)).toContain("local_repo_researcher");
    expect(additionalContext(result)).toContain("competitor_researcher");
    expect(additionalContext(result)).toContain("jobs run-once");
    expect(additionalContext(result)).toContain("Ordinary web_search output");
    expect(additionalContext(result)).not.toContain("App interactive research should use app_handoff by default");
    expect(additionalContext(result)).not.toContain("Do not synchronously launch SDK researcher threads unless explicitly requested");
  });

  it("injects job command for agentic long horizon work prompts", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "What are current practical solutions for agentic long horizon work? 中文回答",
        turnId: "turn-agentic-long-horizon"
      },
      process.cwd()
    );

    expect(additionalContext(result)).toContain("jobs run-once --run-id run-turn-agentic-long-horizon");
    expect(additionalContext(result)).toContain("daemon run");
    expect(additionalContext(result)).not.toContain("research --runner app_handoff");
    expect(additionalContext(result)).not.toContain("SDK researcher threads unless explicitly requested");
  });

  it("injects job command for hidden validation solution prompts", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "Find current practical hidden validation solutions for AI coding agents",
        turnId: "turn-hidden-validation-solutions"
      },
      process.cwd()
    );

    expect(additionalContext(result)).toContain("jobs run-once --run-id run-turn-hidden-validation-solutions");
    expect(additionalContext(result)).not.toContain("app_handoff by default");
  });

  it("queues even simple prompts for daemon routing without blocking in UserPromptSubmit", () => {
    const cwd = tempRepo();
    const simple = userPromptSubmit({ cwd, prompt: "translate hello to Chinese" }, process.cwd());
    expect(simple.decision).toBe("allow");
    expect((simple.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(additionalContext(simple)).toContain("queued a HardFlow job");
    expect(additionalContext(simple)).not.toContain("research --runner app_handoff");
    const bypass = userPromptSubmit({ cwd, prompt: "quick answer: what is TypeScript?", turnId: "turn-bypass" }, process.cwd());
    expect(bypass.decision).toBe("allow");
    expect(additionalContext(bypass)).toContain("jobs run-once --run-id run-turn-bypass");
  });

  it("keeps developer entrypoint warnings out of normal App instructions", () => {
    const cwd = tempRepo();
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "修复 codex-hardflow developer maintenance，明确需要检查 tsx dev entrypoint",
        turnId: "turn-maintenance-dev-entrypoint"
      },
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    expect(additionalContext(result)).toContain("queued a HardFlow job");
    expect(additionalContext(result)).not.toContain("npx tsx src/cli.ts");
  });
});
