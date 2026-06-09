import { describe, expect, it } from "vitest";
import { findPathScopeOverlaps } from "../src/gitUtils.js";

describe("path scope", () => {
  it("detects overlap", () => {
    const overlaps = findPathScopeOverlaps(
      [
        { id: "a", path_scope: ["src/api"] },
        { id: "b", path_scope: ["src/api/routes"] }
      ],
      process.cwd()
    );
    expect(overlaps).toHaveLength(1);
  });
});
