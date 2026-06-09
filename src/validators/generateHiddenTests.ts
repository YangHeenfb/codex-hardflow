import type { ExecutorManifest } from "../schemas.js";
import { compareHiddenCandidateToPublicTests } from "../similarityGuard.js";
import { writePrivateJson } from "../privateStore.js";

export interface HiddenGenerationResult {
  generated: boolean;
  caseCount: number;
  categories: string[];
  max_similarity: number;
  hidden_tests_disclosed: false;
}

export function generateHiddenTests(cwd: string, task: string, manifest: ExecutorManifest, requestedCases = 5): HiddenGenerationResult {
  const categories = [
    ...manifest.case_coverage_summary.not_covered,
    ...manifest.risk_areas,
    "boundary-behavior",
    "malformed-input"
  ].filter((value, index, array) => value.trim().length > 0 && array.indexOf(value) === index);

  const candidate = {
    purpose: categories[0] ?? "uncovered behavior",
    inputs_summary: "fresh dissimilar private input class",
    expected_behavior_summary: "public specification must hold without hardcoded cases",
    boundaries: ["private boundary class"]
  };
  const similarity = compareHiddenCandidateToPublicTests(candidate, manifest.public_tests_added);
  writePrivateJson(cwd, "hidden_metadata.private.json", {
    task,
    generatedAt: new Date().toISOString(),
    caseCount: requestedCases,
    categories,
    max_similarity: similarity.maxSimilarity
  });
  return {
    generated: true,
    caseCount: requestedCases,
    categories,
    max_similarity: similarity.maxSimilarity,
    hidden_tests_disclosed: false
  };
}
