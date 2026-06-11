import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { agentReportsDir, safeReportSegment } from "../paths.js";

export interface DiagnosticExperimentOptions {
  cwd: string;
  experimentId?: string;
  output?: string;
  workdirRoot?: string;
  now?: Date;
}

export interface DiagnosticExperiment {
  experimentId: string;
  sourceRepoRoot: string;
  diagnosticsDir: string;
  planPath: string;
  runsPath: string;
  summaryPath: string;
  outputPath: string;
  workdirRoot: string;
  createdAt: string;
}

export interface IsolatedRunWorkspaceOptions {
  experiment: DiagnosticExperiment;
  variantId: string;
  runId: string;
  excludeDist?: boolean;
  materialize?: boolean;
}

export interface IsolatedRunWorkspace {
  experimentId: string;
  variantId: string;
  runId: string;
  isolatedRepoDir: string;
  isolatedHomeDir: string;
  outputParentPath: string;
  sourceRepoSnapshot: string;
  env: {
    CODEX_HARDFLOW_HOME: string;
  };
}

export interface CopyRepoSnapshotOptions {
  sourceRepoRoot: string;
  isolatedRepoDir: string;
  experimentId: string;
  variantId: string;
  runId: string;
  outputParentPath?: string;
  excludeDist?: boolean;
}

export interface SnapshotMetadata {
  experimentId: string;
  variantId: string;
  runId: string;
  sourceRepoRoot: string;
  createdAt: string;
  excludedPaths: string[];
  includedFileCount: number;
  snapshotHash: string;
}

export interface IsolationAssertionResult {
  passed: boolean;
  contaminationDetected: boolean;
  reasons: string[];
}

const DEFAULT_DIAGNOSTICS_ROOT = join(tmpdir(), "codex-hardflow-diagnostics");
const HIDDEN = "hidden";
const PRIVATE = "private";
const FORBIDDEN_ROOTS = [
  ".agent",
  ".git",
  "node_modules",
  "coverage",
  "tmp",
  "AGENTS.md",
  `${HIDDEN}-tests`,
  `.${HIDDEN}-tests`,
  `.validator-${PRIVATE}`,
  `.agent-${PRIVATE}`,
  `.codex-${PRIVATE}`
];

function iso(date = new Date()): string {
  return date.toISOString();
}

function defaultExperimentId(date = new Date()): string {
  return `diag-${date.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function resolveOutputPath(cwd: string, experimentId: string, output?: string): string {
  if (output?.trim()) return isAbsolute(output) ? output : resolve(cwd, output);
  return join(agentReportsDir(cwd), "diagnostics", experimentId, "summary.json");
}

export function createDiagnosticExperiment(options: DiagnosticExperimentOptions): DiagnosticExperiment {
  const sourceRepoRoot = resolve(options.cwd);
  const createdAt = iso(options.now);
  const experimentId = safeReportSegment(options.experimentId ?? defaultExperimentId(options.now));
  const diagnosticsDir = join(agentReportsDir(sourceRepoRoot), "diagnostics", experimentId);
  const outputPath = resolveOutputPath(sourceRepoRoot, experimentId, options.output);
  const workdirRoot = resolve(options.workdirRoot ?? join(DEFAULT_DIAGNOSTICS_ROOT, experimentId));
  mkdirSync(diagnosticsDir, { recursive: true });
  mkdirSync(dirname(outputPath), { recursive: true });
  return {
    experimentId,
    sourceRepoRoot,
    diagnosticsDir,
    planPath: join(diagnosticsDir, "plan.json"),
    runsPath: join(diagnosticsDir, "runs.jsonl"),
    summaryPath: join(diagnosticsDir, "summary.json"),
    outputPath,
    workdirRoot,
    createdAt
  };
}

function normalizedRel(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).join("/");
}

function privateFile(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return base.endsWith(`.${PRIVATE}.json`) || base.endsWith(`.${HIDDEN}.json`) || base === ".env" || base.startsWith(".env.");
}

function excludedByPattern(relPath: string, excludeDist: boolean, outputParentPath?: string, sourceRepoRoot?: string): boolean {
  const rel = normalizedRel(relPath);
  const first = rel.split("/")[0] ?? rel;
  if (FORBIDDEN_ROOTS.includes(first)) return true;
  if (first === "dist" && excludeDist) return true;
  if (privateFile(rel)) return true;
  if (outputParentPath && sourceRepoRoot) {
    const outputRel = normalizedRel(relative(sourceRepoRoot, outputParentPath));
    if (outputRel && !outputRel.startsWith("..") && (rel === outputRel || rel.startsWith(`${outputRel}/`))) return true;
  }
  return false;
}

function walkFiles(root: string, excludeDist: boolean, outputParentPath: string | undefined, excludedPaths: Set<string>, sourceRepoRoot = root, dir = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = normalizedRel(relative(root, full));
    if (excludedByPattern(rel, excludeDist, outputParentPath, sourceRepoRoot)) {
      excludedPaths.add(rel);
      continue;
    }
    if (entry.isDirectory()) files.push(...walkFiles(root, excludeDist, outputParentPath, excludedPaths, sourceRepoRoot, full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function hashSnapshot(root: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files.map((item) => normalizedRel(relative(root, item))).sort()) {
    const full = join(root, file);
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(full));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function copyRepoSnapshot(options: CopyRepoSnapshotOptions): SnapshotMetadata {
  const sourceRepoRoot = resolve(options.sourceRepoRoot);
  const isolatedRepoDir = resolve(options.isolatedRepoDir);
  const excludedPaths = new Set<string>();
  rmSync(isolatedRepoDir, { recursive: true, force: true });
  mkdirSync(isolatedRepoDir, { recursive: true });
  const files = walkFiles(sourceRepoRoot, options.excludeDist ?? true, options.outputParentPath, excludedPaths, sourceRepoRoot);
  for (const sourceFile of files) {
    const rel = normalizedRel(relative(sourceRepoRoot, sourceFile));
    const target = join(isolatedRepoDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(sourceFile, target);
  }
  const copiedFiles = walkFiles(isolatedRepoDir, false, undefined, new Set(), isolatedRepoDir);
  const metadata: SnapshotMetadata = {
    experimentId: options.experimentId,
    variantId: options.variantId,
    runId: options.runId,
    sourceRepoRoot,
    createdAt: iso(),
    excludedPaths: [...excludedPaths].sort(),
    includedFileCount: copiedFiles.length,
    snapshotHash: hashSnapshot(isolatedRepoDir, copiedFiles)
  };
  writeFileSync(join(isolatedRepoDir, ".agent-diagnostics-snapshot.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

export function createIsolatedRunWorkspace(options: IsolatedRunWorkspaceOptions): IsolatedRunWorkspace {
  const variant = safeReportSegment(options.variantId);
  const root = join(options.experiment.workdirRoot, variant);
  const isolatedRepoDir = join(root, "repo");
  const isolatedHomeDir = join(root, "home");
  mkdirSync(isolatedHomeDir, { recursive: true });
  const workspace: IsolatedRunWorkspace = {
    experimentId: options.experiment.experimentId,
    variantId: options.variantId,
    runId: options.runId,
    isolatedRepoDir,
    isolatedHomeDir,
    outputParentPath: options.experiment.outputPath,
    sourceRepoSnapshot: join(isolatedRepoDir, ".agent-diagnostics-snapshot.json"),
    env: { CODEX_HARDFLOW_HOME: isolatedHomeDir }
  };
  if (options.materialize) {
    copyRepoSnapshot({
      sourceRepoRoot: options.experiment.sourceRepoRoot,
      isolatedRepoDir,
      experimentId: options.experiment.experimentId,
      variantId: options.variantId,
      runId: options.runId,
      outputParentPath: options.experiment.outputPath,
      excludeDist: options.excludeDist ?? true
    });
  }
  return workspace;
}

function pathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertIsolatedWorkspace(options: { workspace: IsolatedRunWorkspace; requireMaterialized?: boolean }): IsolationAssertionResult {
  const reasons: string[] = [];
  const { workspace } = options;
  if (workspace.isolatedRepoDir === workspace.isolatedHomeDir || pathInside(workspace.isolatedRepoDir, workspace.isolatedHomeDir)) {
    reasons.push("CODEX_HARDFLOW_HOME must be outside isolatedRepoDir.");
  }
  if (pathInside(workspace.isolatedRepoDir, workspace.outputParentPath)) {
    reasons.push("diagnostics output path must be outside isolatedRepoDir.");
  }
  if (options.requireMaterialized) {
    if (!existsSync(workspace.sourceRepoSnapshot)) reasons.push("snapshot metadata is missing.");
    for (const forbidden of FORBIDDEN_ROOTS.filter((item) => item !== "tmp")) {
      if (existsSync(join(workspace.isolatedRepoDir, forbidden))) reasons.push(`forbidden path exists in isolated repo: ${forbidden}`);
    }
    if (existsSync(workspace.sourceRepoSnapshot)) {
      const metadata = JSON.parse(readFileSync(workspace.sourceRepoSnapshot, "utf8")) as SnapshotMetadata;
      if (metadata.experimentId !== workspace.experimentId) reasons.push("snapshot experimentId mismatch.");
      if (metadata.variantId !== workspace.variantId) reasons.push("snapshot variantId mismatch.");
      if (metadata.runId !== workspace.runId) reasons.push("snapshot runId mismatch.");
      if (!metadata.snapshotHash) reasons.push("snapshotHash is missing.");
      if (metadata.includedFileCount <= 0) reasons.push("snapshot has no included files.");
    }
  }
  return { passed: reasons.length === 0, contaminationDetected: reasons.length > 0, reasons };
}

export function cleanupDiagnosticWorkspace(path: string): void {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return;
  const stats = statSync(resolved);
  if (!stats.isDirectory()) throw new Error(`Refusing to clean non-directory diagnostic workspace: ${resolved}`);
  rmSync(resolved, { recursive: true, force: true });
}
