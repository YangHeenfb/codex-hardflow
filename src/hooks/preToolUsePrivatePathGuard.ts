import { privateStoreRoot } from "../paths.js";
import { sanitizeText } from "../sanitizer.js";

const BLOCKED_TERMS = [
  ".validator-private",
  ".agent-private",
  ".codex-private",
  "hidden-tests",
  ".hidden-tests",
  "validator_plan.private.json",
  "runner_config.private.json",
  "regression_bank.private.json",
  "final_holdout.private.json"
];

function stringifyInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  return JSON.stringify(input);
}

export function preToolUsePrivatePathGuard(input: unknown): Record<string, unknown> {
  const payload = stringifyInput(input);
  const hiddenDir = process.env.HIDDEN_VALIDATOR_DIR;
  const blocked = [
    ...BLOCKED_TERMS,
    privateStoreRoot(),
    ...(hiddenDir ? [hiddenDir, "HIDDEN_VALIDATOR_DIR"] : [])
  ].filter((term) => term && payload.includes(term));

  const copyIntoRepo = /\b(cp|rsync|ditto)\b[\s\S]*(?:hidden-tests|\.hidden-tests|\.validator-private|\.agent-private|\.codex-private)/i.test(payload);
  const readAttempt = /\b(cat|less|more|ls|grep|rg|find|tail|head|cp|rsync|ditto)\b[\s\S]*(?:hidden-tests|\.hidden-tests|\.validator-private|\.agent-private|\.codex-private|private\.json)/i.test(payload);
  if (blocked.length > 0 || copyIntoRepo || readAttempt) {
    return {
      decision: "block",
      reason: sanitizeText("Blocked access to private validator artifacts. Use sanitized validation summaries only.")
    };
  }
  return { decision: "allow" };
}
