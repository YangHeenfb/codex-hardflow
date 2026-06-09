export function subagentStartContext(): Record<string, unknown> {
  return {
    decision: "allow",
    additionalContext:
      "Follow hardflow role boundaries. Research agents are read-only. Executor must not read hidden validator artifacts. Validator output to executor must be sanitized."
  };
}
