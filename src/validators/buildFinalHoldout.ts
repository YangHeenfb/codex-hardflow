import { writePrivateJson } from "../privateStore.js";

export function buildFinalHoldout(cwd: string, minCases: number): { generated: boolean; min_cases: number; hidden_tests_disclosed: false } {
  writePrivateJson(cwd, "final_holdout.private.json", {
    generatedAt: new Date().toISOString(),
    minCases,
    strategy: "fresh dissimilar holdout metadata; concrete private cases are not emitted to repo-visible files"
  });
  return { generated: true, min_cases: minCases, hidden_tests_disclosed: false };
}
