import { createHash } from "node:crypto";
import type { ValidationCategory } from "../schemas.js";
import { readPrivateJson, writePrivateJson } from "../privateStore.js";

interface RegressionBank {
  updatedAt: string;
  fingerprints: Array<{ fingerprint: string; category: string; severity: string }>;
}

export function updateRegressionBank(cwd: string, categories: ValidationCategory[]): { updated: boolean; count: number } {
  const current = readPrivateJson<RegressionBank>(cwd, "regression_bank.private.json", { updatedAt: new Date().toISOString(), fingerprints: [] });
  for (const category of categories) {
    const fingerprint = createHash("sha256")
      .update(`${category.category}:${category.public_spec_reference}:${category.severity}`)
      .digest("hex")
      .slice(0, 16);
    if (!current.fingerprints.some((item) => item.fingerprint === fingerprint)) {
      current.fingerprints.push({ fingerprint, category: category.category, severity: category.severity });
    }
  }
  current.updatedAt = new Date().toISOString();
  writePrivateJson(cwd, "regression_bank.private.json", current);
  return { updated: true, count: current.fingerprints.length };
}
