export type HardflowInternalPurpose = "router" | "sdk_worker" | "strict_research" | "diagnostics" | "daemon_router" | "daemon_worker";

export interface HardflowInternalContext {
  internal: boolean;
  purpose?: string;
  parentRunId?: string;
  depth: number;
  recursionLimitHit: boolean;
}

export const CODEX_HARDFLOW_INTERNAL_LIMIT = 3;
const INTERNAL_ENV_KEYS = ["CODEX_HARDFLOW_INTERNAL", "CODEX_HARDFLOW_INTERNAL_PURPOSE", "CODEX_HARDFLOW_PARENT_RUN_ID", "CODEX_HARDFLOW_INTERNAL_DEPTH"] as const;
let activeInternalScopes = 0;
let savedInternalEnv: Record<(typeof INTERNAL_ENV_KEYS)[number], string | undefined> | null = null;

function parseDepth(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function hardflowInternalContext(env: NodeJS.ProcessEnv = process.env): HardflowInternalContext {
  const depth = parseDepth(env.CODEX_HARDFLOW_INTERNAL_DEPTH);
  const internal = env.CODEX_HARDFLOW_INTERNAL === "1" || depth >= 1;
  return {
    internal,
    purpose: env.CODEX_HARDFLOW_INTERNAL_PURPOSE,
    parentRunId: env.CODEX_HARDFLOW_PARENT_RUN_ID,
    depth,
    recursionLimitHit: depth > CODEX_HARDFLOW_INTERNAL_LIMIT
  };
}

export function isHardflowInternal(env: NodeJS.ProcessEnv = process.env): boolean {
  return hardflowInternalContext(env).internal;
}

export function internalEnvFor(
  env: NodeJS.ProcessEnv,
  purpose: HardflowInternalPurpose,
  parentRunId: string,
  options: { incrementDepth?: boolean } = {}
): NodeJS.ProcessEnv {
  const currentDepth = parseDepth(env.CODEX_HARDFLOW_INTERNAL_DEPTH);
  const nextDepth = options.incrementDepth === false && currentDepth > 0 ? currentDepth : currentDepth + 1;
  if (nextDepth > CODEX_HARDFLOW_INTERNAL_LIMIT) {
    throw new Error(`internal_recursion_limit: CODEX_HARDFLOW_INTERNAL_DEPTH=${nextDepth}`);
  }
  return {
    ...env,
    CODEX_HARDFLOW_INTERNAL: "1",
    CODEX_HARDFLOW_INTERNAL_PURPOSE: purpose,
    CODEX_HARDFLOW_PARENT_RUN_ID: parentRunId,
    CODEX_HARDFLOW_INTERNAL_DEPTH: String(nextDepth)
  };
}

export async function withHardflowInternalEnv<T>(
  purpose: HardflowInternalPurpose,
  parentRunId: string,
  run: () => Promise<T>,
  options: { incrementDepth?: boolean } = {}
): Promise<T> {
  const next = internalEnvFor(process.env, purpose, parentRunId, options);
  if (activeInternalScopes === 0) {
    savedInternalEnv = {
      CODEX_HARDFLOW_INTERNAL: process.env.CODEX_HARDFLOW_INTERNAL,
      CODEX_HARDFLOW_INTERNAL_PURPOSE: process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE,
      CODEX_HARDFLOW_PARENT_RUN_ID: process.env.CODEX_HARDFLOW_PARENT_RUN_ID,
      CODEX_HARDFLOW_INTERNAL_DEPTH: process.env.CODEX_HARDFLOW_INTERNAL_DEPTH
    };
  }
  activeInternalScopes += 1;
  for (const key of INTERNAL_ENV_KEYS) {
    process.env[key] = next[key];
  }
  try {
    return await run();
  } finally {
    activeInternalScopes = Math.max(0, activeInternalScopes - 1);
    if (activeInternalScopes === 0) {
      const previous = savedInternalEnv;
      savedInternalEnv = null;
      for (const key of INTERNAL_ENV_KEYS) {
        const value = previous?.[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
}

export function withHardflowInternalEnvSync<T>(
  purpose: HardflowInternalPurpose,
  parentRunId: string,
  run: () => T,
  options: { incrementDepth?: boolean } = {}
): T {
  const next = internalEnvFor(process.env, purpose, parentRunId, options);
  const previous: Record<(typeof INTERNAL_ENV_KEYS)[number], string | undefined> = {
    CODEX_HARDFLOW_INTERNAL: process.env.CODEX_HARDFLOW_INTERNAL,
    CODEX_HARDFLOW_INTERNAL_PURPOSE: process.env.CODEX_HARDFLOW_INTERNAL_PURPOSE,
    CODEX_HARDFLOW_PARENT_RUN_ID: process.env.CODEX_HARDFLOW_PARENT_RUN_ID,
    CODEX_HARDFLOW_INTERNAL_DEPTH: process.env.CODEX_HARDFLOW_INTERNAL_DEPTH
  };
  for (const key of INTERNAL_ENV_KEYS) {
    process.env[key] = next[key];
  }
  try {
    return run();
  } finally {
    for (const key of INTERNAL_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
