export type FlagValue = string | boolean;
export type ParsedFlags = Record<string, FlagValue>;

const BOOLEAN_FLAGS = new Set([
  "write-trace",
  "run-router",
  "execute-sdk-research",
  "execute",
  "real-sdk",
  "dry-run",
  "json",
  "help",
  "strict-programmatic",
  "searched-but-no-signal",
  "randomize",
  "no-randomize",
  "materialize-dry-run"
]);

const STRING_FLAGS = new Set([
  "task",
  "buckets",
  "concurrency-levels",
  "repeats",
  "run-id",
  "run-id-prefix",
  "runner",
  "owner",
  "parent-run-id",
  "subagent-name",
  "bucket",
  "raw-user-prompt",
  "turn-id",
  "timeout",
  "phase",
  "config",
  "iteration",
  "max-concurrent",
  "worker-lease",
  "worker-lease-ms",
  "soft-timeout",
  "soft-timeout-ms",
  "hard-timeout",
  "hard-timeout-ms",
  "per-bucket-timeout",
  "global-budget",
  "global-budget-ms",
  "heartbeat-interval",
  "heartbeat-interval-ms",
  "max-no-progress-heartbeats",
  "max-sources-per-worker",
  "timeout-levels",
  "workdir-root",
  "output",
  "baseline-run-id",
  "coverage-mode",
  "parallel-policy",
  "request-id",
  "requested-by",
  "stage",
  "reason",
  "question",
  "required-buckets",
  "urgency",
  "context-ref",
  "related-file",
  "linked-research-run-id",
  "confidence",
  "title",
  "source-type",
  "url-or-ref",
  "url",
  "date-or-version",
  "date",
  "claim",
  "notes",
  "finding",
  "citation",
  "useful-finding",
  "conflicting-finding",
  "source-gap",
  "confidence-summary",
  "final-answer-source",
  "subagent-run-id",
  "agent",
  "status",
  "query",
  "failure-reason",
  "started-at",
  "ended-at"
]);

function parseBooleanFlagValue(key: string, value: string): boolean {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`Invalid --${key}: expected true or false.`);
}

export function parseFlagArgs(args: string[]): { flags: ParsedFlags; rest: string[] } {
  const flags: ParsedFlags = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg?.startsWith("--")) {
      const raw = arg.slice(2);
      const equalsIndex = raw.indexOf("=");
      const key = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
      const inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);
      if (!BOOLEAN_FLAGS.has(key) && !STRING_FLAGS.has(key)) throw new Error(`Unknown flag: --${key}`);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = inlineValue === undefined ? true : parseBooleanFlagValue(key, inlineValue);
        continue;
      }
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
        continue;
      }
      const next = args[i + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing --${key}`);
      flags[key] = next;
      i += 1;
    } else if (arg) {
      rest.push(arg);
    }
  }
  return { flags, rest };
}
