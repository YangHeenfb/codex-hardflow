export type AskProgressMode = "auto" | "quiet" | "verbose" | "json";

export interface AskProgressSnapshot {
  event?: string;
  runId: string;
  status: string;
  route?: string | null;
  requiredBucketCount?: number;
  completedBucketCount?: number;
  runningBucketCount?: number;
  failedBucketCount?: number;
  retryingBucketCount?: number;
  coverageScoreSoFar?: number | null;
  activeWorkerCount?: number;
  elapsedMs?: number;
  message?: string;
  slowestWorker?: string | null;
}

export interface AskProgressRendererOptions {
  mode?: AskProgressMode;
  isTty?: boolean;
  intervalMs?: number;
  now?: () => number;
  write: (message: string) => void;
}

function formatElapsed(ms: number | undefined): string {
  if (!ms || ms < 0) return "00:00";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function compactLine(snapshot: AskProgressSnapshot): string {
  const completed = snapshot.completedBucketCount ?? 0;
  const running = snapshot.runningBucketCount ?? 0;
  const failed = snapshot.failedBucketCount ?? 0;
  const required = snapshot.requiredBucketCount ?? snapshot.activeWorkerCount ?? 0;
  const coverage = snapshot.coverageScoreSoFar ?? "n/a";
  return `HardFlow ${snapshot.status} | run=${snapshot.runId} | ${required} workers | ${completed} done / ${running} running / ${failed} failed | coverage=${coverage} | elapsed=${formatElapsed(snapshot.elapsedMs)}`;
}

function verboseLine(snapshot: AskProgressSnapshot): string {
  return `${compactLine(snapshot)} | retrying=${snapshot.retryingBucketCount ?? 0} | slowest=${snapshot.slowestWorker ?? "n/a"}${snapshot.message ? ` | ${snapshot.message}` : ""}`;
}

function snapshotKey(snapshot: AskProgressSnapshot): string {
  return [
    snapshot.event,
    snapshot.status,
    snapshot.route,
    snapshot.requiredBucketCount,
    snapshot.completedBucketCount,
    snapshot.runningBucketCount,
    snapshot.failedBucketCount,
    snapshot.retryingBucketCount,
    snapshot.coverageScoreSoFar,
    snapshot.message
  ].join("|");
}

export class AskProgressRenderer {
  private readonly mode: AskProgressMode;
  private readonly isTty: boolean;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly write: (message: string) => void;
  private lastRendered = "";
  private lastKey = "";
  private lastAt = 0;
  private lastStatus = "";

  constructor(options: AskProgressRendererOptions) {
    this.mode = options.mode ?? "auto";
    this.isTty = options.isTty === true;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.now = options.now ?? (() => Date.now());
    this.write = options.write;
  }

  render(snapshot: AskProgressSnapshot, force = false): void {
    if (this.mode === "quiet") return;
    const now = this.now();
    const key = snapshotKey(snapshot);
    const statusChanged = snapshot.status !== this.lastStatus;
    const minInterval = this.mode === "auto" && !this.isTty ? Math.max(30_000, this.intervalMs) : this.intervalMs;
    if (!force && key === this.lastKey && now - this.lastAt < minInterval) return;
    if (!force && !statusChanged && now - this.lastAt < minInterval && this.mode !== "json") return;

    if (this.mode === "json") {
      const line = JSON.stringify({ event: snapshot.event ?? "progress", ...snapshot });
      if (line === this.lastRendered && !force) return;
      this.write(`${line}\n`);
      this.lastRendered = line;
    } else {
      const line = this.mode === "verbose" ? verboseLine(snapshot) : compactLine(snapshot);
      if (line === this.lastRendered && !force) return;
      if (this.mode === "auto" && this.isTty) this.write(`\r${line}`);
      else this.write(`${line}\n`);
      this.lastRendered = line;
    }
    this.lastKey = key;
    this.lastStatus = snapshot.status;
    this.lastAt = now;
  }

  finish(): void {
    if (this.mode === "auto" && this.isTty && this.lastRendered) this.write("\n");
  }
}
