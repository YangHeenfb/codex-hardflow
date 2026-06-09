import { describe, expect, it } from "vitest";
import { sanitizeText } from "../src/sanitizer.js";

describe("sanitizer", () => {
  it("removes hidden filenames, exact assertions, fixtures, stack traces, and private paths", () => {
    const raw = `
Failure in /tmp/.hidden-tests/case.hidden.ts
Expected: 42
Received: 41
fixture: {"secret":"value"}
    at hidden (/tmp/.validator-private/runner.js:12:1)
HIDDEN_VALIDATOR_DIR=/tmp/private
`;
    const sanitized = sanitizeText(raw);
    expect(sanitized).not.toContain(".hidden-tests");
    expect(sanitized).not.toContain("case.hidden.ts");
    expect(sanitized).not.toContain("42");
    expect(sanitized).not.toContain("secret");
    expect(sanitized).not.toContain("/tmp/private");
    expect(sanitized).toContain("[stack-frame removed]");
  });
});
