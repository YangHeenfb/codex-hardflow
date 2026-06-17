export type AskProgressMode = "auto" | "minimal" | "quiet" | "verbose" | "json";

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
  frameIntervalMs?: number;
  fancy?: boolean;
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

function shortRunId(runId: string): string {
  if (runId.length <= 8) return runId;
  return `...${runId.slice(-7)}`;
}

function displayStatus(status: string): string {
  if (status === "pending") return "queued";
  return status;
}

function animateStatus(status: string, frame: number): string {
  if (status.length === 0) return status;
  const index = frame % status.length;
  return `${status.slice(0, index)}\x1b[7m${status[index]}\x1b[0m${status.slice(index + 1)}`;
}

function compactLine(snapshot: AskProgressSnapshot, options: { marker?: string; animatedStatus?: string; includeRunId?: boolean } = {}): string {
  const completed = snapshot.completedBucketCount ?? 0;
  const failed = snapshot.failedBucketCount ?? 0;
  const required = snapshot.requiredBucketCount ?? snapshot.activeWorkerCount ?? 0;
  const coverage = snapshot.coverageScoreSoFar ?? "n/a";
  const failedPart = failed > 0 ? ` | ${failed} failed` : "";
  const runPart = options.includeRunId === false ? "" : ` | run ${shortRunId(snapshot.runId)}`;
  return `${options.marker ?? "HardFlow"} ${options.animatedStatus ?? displayStatus(snapshot.status)} ${formatElapsed(snapshot.elapsedMs)} | ${completed}/${required} workers${failedPart} | coverage ${coverage}${runPart}`;
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
  private readonly frameIntervalMs: number;
  private readonly fancy: boolean;
  private readonly now: () => number;
  private readonly write: (message: string) => void;
  private lastRendered = "";
  private lastKey = "";
  private lastAt = 0;
  private lastStatus = "";
  private carriageLineOpen = false;
  private animationFrame = 0;

  constructor(options: AskProgressRendererOptions) {
    this.mode = options.mode ?? "auto";
    this.isTty = options.isTty === true;
    this.intervalMs = options.intervalMs ?? 10_000;
    this.frameIntervalMs = options.frameIntervalMs ?? 150;
    this.fancy = options.fancy === true;
    this.now = options.now ?? (() => Date.now());
    this.write = options.write;
  }

  usesDynamicTty(): boolean {
    return (this.mode === "auto" || this.mode === "minimal") && this.isTty;
  }

  render(snapshot: AskProgressSnapshot, force = false): void {
    if (this.mode === "quiet") return;
    const now = this.now();
    const key = snapshotKey(snapshot);
    const statusChanged = snapshot.status !== this.lastStatus;
    const dynamicTty = this.usesDynamicTty();
    const minInterval = (this.mode === "auto" || this.mode === "minimal") && !this.isTty ? Math.max(30_000, this.intervalMs) : this.intervalMs;
    if (!dynamicTty && !force && key === this.lastKey && now - this.lastAt < minInterval) return;
    if (!dynamicTty && !force && !statusChanged && now - this.lastAt < minInterval && this.mode !== "json") return;
    if (dynamicTty && !force && now - this.lastAt < this.frameIntervalMs) return;

    if (this.mode === "json") {
      const line = JSON.stringify({ event: snapshot.event ?? "progress", ...snapshot });
      if (line === this.lastRendered) return;
      this.write(`${line}\n`);
      this.lastRendered = line;
    } else {
      const spinnerFrames = ["-", "\\", "|", "/"];
      const marker = this.fancy ? spinnerFrames[Math.floor(now / 250) % spinnerFrames.length] : "HardFlow";
      const animatedStatus = dynamicTty ? animateStatus(displayStatus(snapshot.status), this.animationFrame) : undefined;
      const line =
        this.mode === "verbose"
          ? verboseLine(snapshot)
          : compactLine(snapshot, { marker, animatedStatus, includeRunId: this.mode !== "minimal" });
      if (!dynamicTty && line === this.lastRendered) return;
      if (dynamicTty) {
        this.write(`\x1b[2K\r${line}`);
        this.carriageLineOpen = true;
        this.animationFrame += 1;
      } else {
        this.write(`${line}\n`);
        this.carriageLineOpen = false;
      }
      this.lastRendered = line;
    }
    this.lastKey = key;
    this.lastStatus = snapshot.status;
    this.lastAt = now;
  }

  finish(): void {
    if ((this.mode === "auto" || this.mode === "minimal") && this.isTty && this.carriageLineOpen) {
      this.write("\x1b[2K\r\n");
      this.carriageLineOpen = false;
    }
  }
}
