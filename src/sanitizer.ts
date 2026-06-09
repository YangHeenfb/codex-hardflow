import type { ValidationSummary } from "./schemas.js";

const PRIVATE_PATTERNS = [
  /(?:^|\s)(?:[A-Za-z]:)?[^\s"'`]*(?:\.validator-private|\.agent-private|\.codex-private|hidden-tests|\.hidden-tests)[^\s"'`]*/gi,
  /(?:^|\s)[^\s"'`]*\.local\/share\/codex-hardflow\/private[^\s"'`]*/gi,
  /(?:validator_plan|runner_config|regression_bank|final_holdout)\.private\.json/gi,
  /\b[\w.-]+\.hidden\.(?:json|js|ts|mjs|cjs)\b/gi,
  /\b[\w.-]+\.private\.(?:json|js|ts|mjs|cjs)\b/gi
];

export function sanitizeText(raw: string): string {
  let text = raw;
  for (const pattern of PRIVATE_PATTERNS) {
    text = text.replace(pattern, " [private-artifact]");
  }
  text = text.replace(/HIDDEN_VALIDATOR_DIR\s*=\s*[^\s]+/gi, "HIDDEN_VALIDATOR_DIR=[redacted]");
  text = text.replace(/^\s*at\s+.*(?:\n|$)/gm, "[stack-frame removed]\n");
  text = text.replace(/(Expected|Received|Actual|AssertionError):\s*.*$/gim, "$1: [redacted hidden assertion]");
  text = text.replace(/((?:fixture|hidden input|hidden output|case value|exact input)\s*[:=]\s*)(["'`][\s\S]*?["'`]|\[[^\]]*\]|\{[^}]*\}|[^\n]+)/gi, "$1[redacted]");
  text = text.replace(/case\s+["'`][^"'`]+["'`]/gi, "case [redacted]");
  return text.trim();
}

export function sanitizeValidationSummary(summary: ValidationSummary): ValidationSummary {
  return {
    ...summary,
    hidden_tests_disclosed: false,
    categories: summary.categories.map((category) => ({
      ...category,
      summary: sanitizeText(category.summary),
      public_hint: sanitizeText(category.public_hint),
      likely_affected_area: sanitizeText(category.likely_affected_area)
    })),
    next_repair_prompt: sanitizeText(summary.next_repair_prompt)
  };
}
