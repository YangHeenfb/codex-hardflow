import { readFileSync } from "node:fs";
import type { ModulesFile } from "./schemas.js";
import { cleanWorkspaceStrategy, findPathScopeOverlaps, hasHeadCommit } from "./gitUtils.js";
import { HardflowError } from "./errors.js";

function parseScalar(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

export function parseModulesFile(filePath: string): ModulesFile {
  const raw = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw) as ModulesFile;
  } catch {
    // Minimal YAML support for the documented shape; JSON is preferred for automation.
    const task = raw.match(/^task:\s*(.+)$/m)?.[1] ?? "";
    const shared = raw.match(/^shared_contract_paths:\s*\[(.*)\]/m)?.[1]?.split(",").map(parseScalar).filter(Boolean) ?? [];
    const modules: ModulesFile["modules"] = [];
    const blocks = raw.split(/\n(?=\s*-\s+id:)/g);
    for (const block of blocks) {
      const id = block.match(/-\s+id:\s*(.+)/)?.[1];
      if (!id) continue;
      const prompt = block.match(/prompt:\s*(.+)/)?.[1] ?? "";
      const pathScope = block.match(/path_scope:\s*\[(.*)\]/)?.[1]?.split(",").map(parseScalar).filter(Boolean) ?? [];
      const test = block.match(/test_command:\s*(.+)/)?.[1];
      modules.push({ id: parseScalar(id), prompt: parseScalar(prompt), path_scope: pathScope, test_command: test ? parseScalar(test) : undefined, dependencies: [] });
    }
    if (!task || modules.length === 0) {
      throw new HardflowError("modules.yaml must be JSON or the documented simple YAML shape.", "MODULES_PARSE_FAILED");
    }
    return { task: parseScalar(task), modules, shared_contract_paths: shared };
  }
}

export function planParallelModules(filePath: string, cwd: string, execute = false): Record<string, unknown> {
  const modulesFile = parseModulesFile(filePath);
  const overlaps = findPathScopeOverlaps(modulesFile.modules, cwd);
  const strategy = cleanWorkspaceStrategy(cwd);
  const headExists = hasHeadCommit(cwd);
  const dryRun = !execute || !headExists;
  return {
    task: modulesFile.task,
    dryRun,
    executeRequested: execute,
    headExists,
    strategy,
    sharedContractPaths: modulesFile.shared_contract_paths,
    overlaps,
    canRunParallelWriters: overlaps.length === 0 && headExists && execute,
    reason: overlaps.length > 0 ? "Overlapping path_scope blocks parallel writers." : strategy.reason,
    modules: modulesFile.modules.map((module) => ({
      id: module.id,
      path_scope: module.path_scope,
      workerPromptConstraint: "Worker may modify only files inside path_scope and must write executor_manifest."
    }))
  };
}
