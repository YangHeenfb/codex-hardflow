import { describe, expect, it } from "vitest";
import { compareHiddenCandidateToPublicTests } from "../src/similarityGuard.js";

describe("similarity guard", () => {
  it("detects highly similar hidden candidates", () => {
    const result = compareHiddenCandidateToPublicTests(
      {
        purpose: "validates empty string boundary",
        inputs_summary: "empty string",
        expected_behavior_summary: "returns validation error"
      },
      [
        {
          file: "tests/public.test.ts",
          case_name: "empty",
          purpose: "validates empty string boundary",
          inputs_summary: "empty string",
          expected_behavior_summary: "returns validation error"
        }
      ]
    );
    expect(result.tooSimilar).toBe(true);
  });
});
