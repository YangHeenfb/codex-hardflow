import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { userPromptSubmit } from "../src/hooks/userPromptSubmit.js";

function additionalContext(result: Record<string, unknown>): string {
  return String((result.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext ?? "");
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
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    expect((result.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(result).not.toHaveProperty("additionalContext");
    expect(additionalContext(result)).toContain("router preflight");
    expect(additionalContext(result)).toContain("router_trace");
    expect(additionalContext(result)).toContain("not by keyword matching");
    expect(additionalContext(result)).toContain("official_docs_researcher");
    expect(additionalContext(result)).toContain("codex_default_researcher");
    expect(additionalContext(result)).toContain("Spawn the relevant source-specific researcher subagents");
    expect(additionalContext(result)).toContain("subagent_status = \"not_spawned\"");
    expect(additionalContext(result)).toContain("hardflow injected context is the explicit request");
    expect(additionalContext(result)).toContain("codex-hardflow report add-source");
    expect(additionalContext(result)).toContain("codex-hardflow report finalize-manual");
    expect(additionalContext(result)).toContain("research --runner app_handoff");
    expect(additionalContext(result)).toContain("--run-id");
    expect(additionalContext(result)).toContain("runs/");
    expect(additionalContext(result)).toContain("subagents/");
    expect(additionalContext(result)).toContain("Do not synchronously launch SDK researcher threads");
    expect(additionalContext(result)).not.toContain("node --import tsx");
    expect(additionalContext(result)).not.toContain("npx tsx src/cli.ts");
  });

  it("injects local_repo and competitor researchers for current-project comparison prompts", () => {
    const result = userPromptSubmit(
      {
        cwd: process.cwd(),
        prompt: "我这个项目有什么类似产品/项目？有哪些可以吸收改进的？",
        turnId: "turn-userprompt-local-competitors"
      },
      process.cwd()
    );

    expect(additionalContext(result)).toContain("local_repo_researcher");
    expect(additionalContext(result)).toContain("competitor_researcher");
    expect(additionalContext(result)).toContain("Spawn the relevant source-specific researcher subagents");
  });

  it("does not overblock simple or bypassed prompts", () => {
    const simple = userPromptSubmit({ prompt: "translate hello to Chinese" }, process.cwd());
    expect(simple.decision).toBe("allow");
    expect((simple.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe("UserPromptSubmit");
    expect(additionalContext(simple)).toContain("router preflight");
    expect(additionalContext(simple)).not.toContain("Spawn the relevant source-specific researcher subagents");
    const bypass = userPromptSubmit({ prompt: "quick answer: what is TypeScript?", turnId: "turn-bypass" }, process.cwd());
    expect(bypass.decision).toBe("allow");
    expect(additionalContext(bypass)).toContain("set route=router_failed");
    expect(additionalContext(bypass)).toContain("If router fails");
  });

  it("keeps developer entrypoint warnings out of normal App instructions", () => {
    const result = userPromptSubmit(
      {
        cwd: process.cwd(),
        prompt: "修复 codex-hardflow developer maintenance，明确需要检查 tsx dev entrypoint",
        turnId: "turn-maintenance-dev-entrypoint"
      },
      process.cwd()
    );

    expect(result.decision).toBe("allow");
    expect(additionalContext(result)).toContain("router preflight");
    expect(additionalContext(result)).not.toContain("npx tsx src/cli.ts");
  });
});
