import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGlobalHooksConfig } from "../src/config.js";

describe("global hooks config", () => {
  it("generates the Codex three-level hooks.json schema", () => {
    const config = buildGlobalHooksConfig(process.cwd());
    const hooks = config.hooks as Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
    const expectedEvents = ["UserPromptSubmit", "PreToolUse", "Stop", "SubagentStart", "SubagentStop"];
    const unusedEvents = ["PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SessionStart"];
    const bin = resolve(process.cwd(), "bin", "codex-hardflow");

    expect(config).toHaveProperty("hooks");
    for (const event of expectedEvents) {
      expect(hooks[event]).toBeDefined();
      expect(hooks[event]).toHaveLength(1);
      expect(hooks[event]?.[0]).toHaveProperty("hooks");
      expect(hooks[event]?.[0]?.hooks).toHaveLength(1);
      expect(hooks[event]?.[0]?.hooks[0]?.type).toBe("command");
      expect(String(hooks[event]?.[0]?.hooks[0]?.command)).toMatch(new RegExp(`^${bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} hook `));
      expect(typeof hooks[event]?.[0]?.hooks[0]?.timeout).toBe("number");
      expect(typeof hooks[event]?.[0]?.hooks[0]?.statusMessage).toBe("string");
    }
    for (const event of unusedEvents) {
      expect(hooks[event]).toBeUndefined();
    }
  });

  it("covers supported PreToolUse tool names and aliases", () => {
    const config = buildGlobalHooksConfig(process.cwd());
    const matcher = config.hooks.PreToolUse[0]?.matcher;

    expect(matcher).toBe("Bash|apply_patch|Edit|Write|mcp__.*filesystem.*");
    const pattern = new RegExp(matcher ?? "");
    expect("Bash").toMatch(pattern);
    expect("apply_patch").toMatch(pattern);
    expect("Edit").toMatch(pattern);
    expect("Write").toMatch(pattern);
    expect("mcp__filesystem__read_file").toMatch(pattern);
  });
});
