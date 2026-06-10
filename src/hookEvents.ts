import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hashText, markerExpired, type HookMarker } from "./hookState.js";
import { hardflowStateDir, repoHash, researchRunHookEventsPath, researchRunRouterTracePath } from "./paths.js";
import type { TriggerSource } from "./schemas.js";

export const HOOK_AUDIT_VERSION = "programmatic-trigger-v1";

export type HookEventName = "UserPromptSubmit" | "Stop" | "CLI";

export interface HookAuditEvent {
  eventName: HookEventName;
  runId?: string;
  turnId?: string;
  promptHash?: string;
  triggerSource?: TriggerSource;
  programmaticTrigger?: boolean;
  createdAt: string;
  injectedAdditionalContextHash?: string;
  hookVersion?: string;
  cwd: string;
  decision?: string;
  reason?: string;
  command?: string;
}

function stateHookEventsPath(cwd: string): string {
  return join(hardflowStateDir(), repoHash(cwd), "hook_events.jsonl");
}

function eventPath(cwd: string, runId?: string): string {
  return runId ? researchRunHookEventsPath(cwd, runId) : stateHookEventsPath(cwd);
}

export function appendHookEvent(cwd: string, event: Omit<HookAuditEvent, "createdAt" | "cwd"> & { createdAt?: string; cwd?: string }): HookAuditEvent {
  const resolvedCwd = resolve(event.cwd ?? cwd);
  const full: HookAuditEvent = {
    ...event,
    cwd: resolvedCwd,
    createdAt: event.createdAt ?? new Date().toISOString(),
    hookVersion: event.hookVersion ?? HOOK_AUDIT_VERSION
  };
  const target = eventPath(resolvedCwd, full.runId);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(full)}\n`, { flag: "a" });
  return full;
}

export function hashAdditionalContext(value: string): string {
  return hashText(value);
}

export function readHookEvents(cwd: string, runId?: string): HookAuditEvent[] {
  const target = eventPath(resolve(cwd), runId);
  if (!existsSync(target)) return [];
  return readFileSync(target, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HookAuditEvent);
}

export function findMarkerByRunId(cwd: string, runId: string): HookMarker | null {
  const root = join(hardflowStateDir(), repoHash(resolve(cwd)));
  if (!existsSync(root)) return null;
  const markers = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "threads")
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(join(root, entry.name, "hook_state.json"), "utf8")) as HookMarker;
      } catch {
        return null;
      }
    })
    .filter((marker): marker is HookMarker => marker?.runId === runId);
  markers.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return markers[0] ?? null;
}

export interface HookActiveAssertion {
  passed: boolean;
  runId: string;
  userPromptSubmitEvent: boolean;
  markerExists: boolean;
  routerTraceExists: boolean;
  routerPreflightRequested: boolean;
  programmaticTrigger: boolean;
  reason?: string;
}

export function hookStatus(cwd: string, runId?: string): Record<string, unknown> {
  const events = readHookEvents(cwd, runId);
  const marker = runId ? findMarkerByRunId(cwd, runId) : null;
  return {
    runId,
    eventsPath: eventPath(resolve(cwd), runId),
    eventCount: events.length,
    events,
    marker: marker
      ? {
          runId: marker.runId,
          turnId: marker.turnId,
          triggerSource: marker.triggerSource,
          programmaticTrigger: marker.programmaticTrigger,
          status: marker.status,
          expired: markerExpired(marker)
        }
      : null
  };
}

export function assertHookActive(cwd: string, runId: string): HookActiveAssertion {
  const marker = findMarkerByRunId(cwd, runId);
  const events = readHookEvents(cwd, runId);
  const userPromptSubmitEvent = events.some((event) => event.eventName === "UserPromptSubmit");
  const cliEvent = events.some((event) => event.eventName === "CLI" && event.programmaticTrigger === true);
  const routerTraceExists = existsSync(researchRunRouterTracePath(cwd, runId));
  const routerPreflightRequested = marker?.taskType === "router-preflight";
  const programmaticTrigger = Boolean(marker?.programmaticTrigger || userPromptSubmitEvent || cliEvent);
  const passed = Boolean(marker && (userPromptSubmitEvent || cliEvent) && (routerTraceExists || routerPreflightRequested) && programmaticTrigger);
  return {
    passed,
    runId,
    userPromptSubmitEvent,
    markerExists: Boolean(marker),
    routerTraceExists,
    routerPreflightRequested,
    programmaticTrigger,
    reason: passed ? undefined : "Hardflow run is missing a programmatic hook/CLI trigger audit trail."
  };
}
