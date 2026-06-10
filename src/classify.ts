import type { TaskClassification } from "./schemas.js";

const re = (pattern: RegExp, text: string) => pattern.test(text);

export function safetyHeuristics(task: string): TaskClassification {
  const text = task.toLowerCase();
  const troubleshooting = re(/\b(error|fails?|failing|debug|troubleshoot|bug|regression|stack trace|not working)\b|调试|故障|报错|失败/, text);
  const currentState = re(/\b(latest|current|today|recent|up[- ]?to[- ]?date|now|202[5-9]|best option|best practice)\b/, text);
  const architectureChoice = re(/\b(architecture|design choice|tradeoff|system design|migration|production|scalability|performance)\b|架构|生产/, text);
  const frameworkChoice = re(/\b(framework|library|package|sdk|tool comparison|tool-comparison|compare|alternative|choose|selection)\b|框架|选型|对比/, text);
  const implementation = re(/\b(implement|build|code|fix|modify|create|add|refactor|test|hook|cli|install)\b|修复|修改|新增|安装/, text);
  const solutionFinding = re(/\b(solution|workaround|how do i|how to|solve|approach|recommend|decide)\b|方案|解决/, text);
  const validationSensitive = implementation || re(/\b(hidden test|validator|validation|security|auth|permission|sandbox|secret|token|payment|ci\/cd|mcp|browser)\b/, text);
  const parallelModules = re(/\b(parallel|module|modules|worktree|path_scope|independent)\b/, text);
  const securityRelevant = re(/\b(security|auth|permission|sandbox|secret|token|dependency|network|browser|mcp|plugin|ci\/cd|cve)\b/, text);
  const agentRelevant = re(/\b(agent framework|agent-framework|ai agent|ai coding agent|coding agent|multi-agent|subagent|hidden validation|source coverage|source matrix)\b/, text);
  const evaluationRelevant = re(/\b(evaluation|evals?|benchmark|hidden validation|validator|final holdout|holdout)\b/, text);
  const productionRelevant = architectureChoice || re(/\b(production|ci\/cd|deploy|deployment|operat(?:e|ions)|reliability)\b/, text);
  const academicRelevant = re(/\b(algorithm|ml|distributed|performance|security|architecture research)\b/, text) || agentRelevant || evaluationRelevant;
  const packageRelevant = frameworkChoice || re(/\b(npm|package|version|dependency|release|registry|sdk)\b/, text);
  const competitorRelevant = re(/\b(compare|competitor|alternative|alternatives|versus|vs\.?|platform choice|product comparison|similar products?|similar projects?)\b|类似(?:的)?(?:产品|项目|产品或者项目)|竞品|可吸收|对比/, text);
  const localRepoRelevant = re(/\b(this repo|current repo|current project|our project|this project|local repo|codebase)\b|我这个项目|当前项目|这个项目|当前 repo|这个 repo/, text);
  const privateConnectorsExplicit = re(/\b(private|internal|company)\s+(github|gmail|linear|notion|docs?|tickets?)\b|\b(gmail|linear|notion)\b/, text);
  const researchHeavy = currentState || troubleshooting || architectureChoice || frameworkChoice || solutionFinding || academicRelevant || competitorRelevant || localRepoRelevant || re(/\bresearch\b|研究/, text);

  return {
    researchHeavy,
    solutionFinding,
    currentState,
    troubleshooting,
    architectureChoice,
    frameworkChoice,
    implementation,
    validationSensitive,
    parallelModules,
    privateConnectorsExplicit,
    securityRelevant,
    academicRelevant,
    packageRelevant,
    competitorRelevant,
    agentRelevant,
    evaluationRelevant,
    productionRelevant,
    localRepoRelevant
  };
}

export function shouldUseHardflow(task: string): boolean {
  const c = safetyHeuristics(task);
  return c.researchHeavy || c.implementation || c.validationSensitive || c.parallelModules;
}

/**
 * Deprecated compatibility alias. Do not use as the primary route source.
 * The LLM router owns task routing; this helper is only for deterministic
 * safety/preflight diagnostics.
 */
export const classifyTask = safetyHeuristics;
