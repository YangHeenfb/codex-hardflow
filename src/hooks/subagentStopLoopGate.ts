export function subagentStopLoopGate(input: Record<string, unknown> = {}): Record<string, unknown> {
  if (input.requiresSchema === true && input.schemaPresent !== true) {
    return { decision: "block", reason: "Required hardflow subagent output schema is missing; continue until the schema is produced." };
  }
  return { decision: "allow" };
}
