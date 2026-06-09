import { DEFAULT_LOOP_CONFIG } from "./config.js";
import type { LoopConfig, ValidationSummary } from "./schemas.js";

export function nextLoopAction(summary: ValidationSummary, config: LoopConfig = DEFAULT_LOOP_CONFIG): ValidationSummary["repair_loop_next_action"] {
  if (summary.hidden_status === "failed") {
    return summary.iteration >= config.max_repair_cycles ? "stop" : "repair";
  }
  if (summary.hidden_status === "passed" && summary.final_holdout_status === "not_run") {
    return "holdout";
  }
  if (summary.final_holdout_status === "failed") {
    return summary.iteration >= config.max_repair_cycles ? "stop" : "repair";
  }
  return "done";
}

export function shouldContinueRepair(summary: ValidationSummary, config: LoopConfig = DEFAULT_LOOP_CONFIG): boolean {
  return nextLoopAction(summary, config) === "repair";
}
