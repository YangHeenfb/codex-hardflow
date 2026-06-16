import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { markerPathFor } from "../src/hookState.js";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";
import { repoHash, researchRunRouterTracePath } from "../src/paths.js";
import type { RouterOutput } from "../src/router/routerSchema.js";
import { failingRouteRunner, fakeRouteRunner } from "./hookTestUtils.js";
import { currentProjectCompetitorRouterOutput, routerOutputForBuckets } from "./routerFixtures.js";

function additionalContext(result: Record<string, unknown>): string {
  return String((result.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext ?? "");
}

function directOutput(): RouterOutput {
  return routerOutputForBuckets([], {
    route: "direct_answer",
    workflowPattern: "direct",
    researchProfile: "none",
    requiresSourceMatrix: false,
    reasons: ["Direct answer."],
    risks: []
  });
}

describe("UserPromptSubmit router preflight injection", () => {
  beforeEach(() => {
    process.env.CODEX_HARDFLOW_HOME = mkdtempSync(join(tmpdir(), "hardflow-state-"));
  });

  it("injects router preflight without top-level additionalContext", () => {
    const result = userPromptSubmit(
      {
        cwd: process.cwd(),
        prompt: "What are current best practices for AI agent framework evaluation?",
        turnId: "turn-userprompt-research"
      },
      process.cwd(),
      { routeRunner: fakeRouteRunner(routerOutputForBuckets(["official_docs", "github", "codex_default_discovery"])) }
    );

    expect(result.decision).toBe("allow");
    expect((result.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(result).not.toHaveProperty("additionalContext");
    expect(additionalContext(result)).toContain("router preflight");
    expect(additionalContext(result)).toContain("router_trace");
    expect(additionalContext(result)).toContain("not by keyword matching");
    expect(additionalContext(result)).toContain("official_docs_researcher");
    expect(additionalContext(result)).toContain("codex_default_researcher");
    expect(additionalContext(result)).toContain("routeStatus=routed");
    expect(additionalContext(result)).toContain("route=research");
    expect(additionalContext(result)).toContain("research --strict-programmatic --coverage-mode exhaustive --parallel-policy all_required");
    expect(additionalContext(result)).toContain("strict_programmatic/sdk_threads only");
    expect(additionalContext(result)).toContain("ResearchRequest CLI examples");
    expect(additionalContext(result)).not.toContain("research --runner app_handoff");
    expect(additionalContext(result)).toContain("--run-id");
    expect(additionalContext(result)).toContain("runs/");
    expect(additionalContext(result)).toContain("App subagents remain best-effort");
    expect(additionalContext(result)).not.toContain("node --import tsx");
    expect(additionalContext(result)).not.toContain("npx tsx src/cli.ts");
  });

  it("runs route directly, writes router_trace, and marks the marker routed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-userprompt-route-"));
    userPromptSubmit(
      {
        cwd,
        prompt: "What are current practical solutions for agent memory?",
        turnId: "turn-direct-route"
      },
      process.cwd(),
      { routeRunner: fakeRouteRunner(routerOutputForBuckets(["official_docs", "github"])) }
    );
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-direct-route"), "utf8")) as Record<string, unknown>;

    expect(marker.routeStatus).toBe("routed");
    expect(marker.routerPreflightSource).toBe("user_prompt_submit");
    expect(marker.routerPreflightSucceeded).toBe(true);
    expect(marker.routerRoute).toBe("research");
    expect(existsSync(researchRunRouterTracePath(cwd, String(marker.runId)))).toBe(true);
  });

  it("marks router_failed when direct route preflight fails", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-userprompt-route-fail-"));
    const result = userPromptSubmit(
      {
        cwd,
        prompt: "What are current practical solutions for agent memory?",
        turnId: "turn-direct-route-failed"
      },
      process.cwd(),
      { routeRunner: failingRouteRunner("router timed out") }
    );
    const marker = JSON.parse(readFileSync(markerPathFor(repoHash(cwd), "turn-direct-route-failed"), "utf8")) as Record<string, unknown>;

    expect(marker.routeStatus).toBe("router_failed");
    expect(marker.routerPreflightSucceeded).toBe(false);
    expect(marker.routerPreflightFailureReason).toBe("router timed out");
    expect(additionalContext(result)).toContain("Router preflight failed");
  });

  it("injects local_repo and competitor researchers for current-project comparison prompts", () => {
    const result = userPromptSubmit(
      {
        cwd: process.cwd(),
        prompt: "我现在这个项目做的multi agent结构有什么类似的产品或者项目？有哪些我可以吸收改进的？",
        turnId: "turn-userprompt-local-competitors"
      },
      process.cwd(),
      { routeRunner: fakeRouteRunner(currentProjectCompetitorRouterOutput) }
    );

    expect(additionalContext(result)).toContain("local_repo_researcher");
    expect(additionalContext(result)).toContain("competitor_researcher");
    expect(additionalContext(result)).toContain("research --strict-programmatic --coverage-mode exhaustive --parallel-policy all_required");
    expect(additionalContext(result)).toContain("Ordinary web_search output");
    expect(additionalContext(result)).not.toContain("App interactive research should use app_handoff by default");
    expect(additionalContext(result)).not.toContain("Do not synchronously launch SDK researcher threads unless explicitly requested");
  });

  it("injects strict research command for agentic long horizon work prompts", () => {
    const result = userPromptSubmit(
      {
        cwd: process.cwd(),
        prompt: "What are current practical solutions for agentic long horizon work? 中文回答",
        turnId: "turn-agentic-long-horizon"
      },
      process.cwd(),
      { routeRunner: fakeRouteRunner(routerOutputForBuckets(["official_docs", "academic", "codex_default_discovery"])) }
    );

    expect(additionalContext(result)).toContain("research --strict-programmatic --coverage-mode exhaustive --parallel-policy all_required");
    expect(additionalContext(result)).toContain("--parallel-policy all_required");
    expect(additionalContext(result)).not.toContain("research --runner app_handoff");
    expect(additionalContext(result)).not.toContain("SDK researcher threads unless explicitly requested");
  });

  it("injects strict research command for hidden validation solution prompts", () => {
    const result = userPromptSubmit(
      {
        cwd: process.cwd(),
        prompt: "Find current practical hidden validation solutions for AI coding agents",
        turnId: "turn-hidden-validation-solutions"
      },
      process.cwd(),
      { routeRunner: fakeRouteRunner(routerOutputForBuckets(["official_docs", "security", "academic", "codex_default_discovery"])) }
    );

    expect(additionalContext(result)).toContain("research --strict-programmatic --coverage-mode exhaustive --parallel-policy all_required");
    expect(additionalContext(result)).not.toContain("app_handoff by default");
  });

  it("does not overblock simple or bypassed prompts", () => {
    const simple = userPromptSubmit({ prompt: "translate hello to Chinese" }, process.cwd(), { routeRunner: fakeRouteRunner(directOutput()) });
    expect(simple.decision).toBe("allow");
    expect((simple.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(additionalContext(simple)).toContain("router preflight");
    expect(additionalContext(simple)).toContain("route=direct_answer");
    expect(additionalContext(simple)).not.toContain("research --runner app_handoff");
    const bypass = userPromptSubmit({ prompt: "quick answer: what is TypeScript?", turnId: "turn-bypass" }, process.cwd(), { routeRunner: fakeRouteRunner(directOutput()) });
    expect(bypass.decision).toBe("allow");
    expect(additionalContext(bypass)).toContain("route=direct_answer");
    expect(additionalContext(bypass)).toContain("do not use keyword fallback");
  });

  it("keeps developer entrypoint warnings out of normal App instructions", () => {
    const result = userPromptSubmit(
      {
        cwd: process.cwd(),
        prompt: "修复 codex-hardflow developer maintenance，明确需要检查 tsx dev entrypoint",
        turnId: "turn-maintenance-dev-entrypoint"
      },
      process.cwd(),
      { routeRunner: fakeRouteRunner(directOutput()) }
    );

    expect(result.decision).toBe("allow");
    expect(additionalContext(result)).toContain("router preflight");
    expect(additionalContext(result)).not.toContain("npx tsx src/cli.ts");
  });
});
