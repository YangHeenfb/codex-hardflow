import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertOutsideRepo } from "../src/privateStore.js";

describe("private store", () => {
  it("refuses repo-internal private paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hardflow-store-"));
    expect(() => assertOutsideRepo(join(cwd, ".validator-private"), cwd)).toThrow(/Private store/);
  });
});
