import { describe, expect, it } from "vitest";
import { parseFlagArgs } from "../src/flagParser.js";

describe("typed CLI flag parser", () => {
  it("keeps task text positional after boolean flags", () => {
    const parsed = parseFlagArgs(["--run-id", "X", "--write-trace", "task text"]);
    expect(parsed.flags["run-id"]).toBe("X");
    expect(parsed.flags["write-trace"]).toBe(true);
    expect(parsed.rest).toEqual(["task text"]);
  });

  it("supports flags after task text", () => {
    const parsed = parseFlagArgs(["task text", "--run-id", "X", "--write-trace"]);
    expect(parsed.flags["run-id"]).toBe("X");
    expect(parsed.flags["write-trace"]).toBe(true);
    expect(parsed.rest).toEqual(["task text"]);
  });

  it("supports explicit boolean false", () => {
    const parsed = parseFlagArgs(["--write-trace=false", "task text"]);
    expect(parsed.flags["write-trace"]).toBe(false);
    expect(parsed.rest).toEqual(["task text"]);
  });

  it("still consumes string flag values", () => {
    const parsed = parseFlagArgs(["--runner", "app_handoff", "--coverage-mode", "balanced", "--run-id=run-a", "task text"]);
    expect(parsed.flags.runner).toBe("app_handoff");
    expect(parsed.flags["coverage-mode"]).toBe("balanced");
    expect(parsed.flags["run-id"]).toBe("run-a");
    expect(parsed.rest).toEqual(["task text"]);
  });

  it("fails unknown flags clearly", () => {
    expect(() => parseFlagArgs(["--unknown", "task text"])).toThrow("Unknown flag: --unknown");
  });
});
