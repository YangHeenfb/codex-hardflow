import type { PublicTestCaseSummary } from "./schemas.js";

export interface HiddenCandidateSummary {
  purpose: string;
  inputs_summary: string;
  expected_behavior_summary: string;
  boundaries?: string[];
}

export interface SimilarityResult {
  maxSimilarity: number;
  tooSimilar: boolean;
  reason: string;
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / union.size;
}

function joined(value: PublicTestCaseSummary | HiddenCandidateSummary): string {
  const boundaries = "boundaries" in value ? value.boundaries ?? [] : [];
  return [value.purpose, value.inputs_summary, value.expected_behavior_summary, ...boundaries].join(" ");
}

export function compareHiddenCandidateToPublicTests(
  candidate: HiddenCandidateSummary,
  publicTests: PublicTestCaseSummary[],
  threshold = 0.65
): SimilarityResult {
  let maxSimilarity = 0;
  for (const publicTest of publicTests) {
    const whole = jaccard(tokens(joined(candidate)), tokens(joined(publicTest)));
    const purpose = jaccard(tokens(candidate.purpose), tokens(publicTest.purpose));
    const inputs = jaccard(tokens(candidate.inputs_summary), tokens(publicTest.inputs_summary));
    const expected = jaccard(tokens(candidate.expected_behavior_summary), tokens(publicTest.expected_behavior_summary));
    maxSimilarity = Math.max(maxSimilarity, whole, purpose, inputs, expected);
  }
  return {
    maxSimilarity,
    tooSimilar: maxSimilarity >= threshold,
    reason: maxSimilarity >= threshold ? "Hidden candidate overlaps public test purpose or input class." : "Hidden candidate is sufficiently dissimilar from public tests."
  };
}
