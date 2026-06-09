import { describe, expect, it } from "vitest";
import { preToolUsePrivatePathGuard } from "../src/hooks/preToolUsePrivatePathGuard.js";

describe("private path guard", () => {
  it("blocks obvious private artifact reads", () => {
    const result = preToolUsePrivatePathGuard({ command: "cat .hidden-tests/failure.hidden.json" });
    expect(result.decision).toBe("block");
    expect(JSON.stringify(result)).not.toContain("failure.hidden.json");
  });

  it("allows normal source commands", () => {
    expect(preToolUsePrivatePathGuard({ command: "rg sourceMatrix src tests" }).decision).toBe("allow");
  });
});
