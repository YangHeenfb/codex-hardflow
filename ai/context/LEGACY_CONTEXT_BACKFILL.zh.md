# codex-hardflow 旧上下文回填包

## 日期

2026-06-12

## 来源

旧 ChatGPT Web 规划对话摘要。

## 警告

这是迁移摘要，不是自动验证事实。使用任何声明前，应优先看 repo 文件、
当前 PR、命令输出和 durable decision records。

## 1. Project One-Liner

codex-hardflow 是一个给 Codex 以及未来其它 coding agent 使用的程序化
工作流 harness。它的核心目标不是多 agent 聊天，而是解决三个问题：

1. 默认搜索范围不够，需要更深、更广地搜索官方文档、GitHub、社区、
   学术、安全、包注册表、工程博客、竞品、本地仓库和默认发现。
2. executor 容易针对公开测试或验收标准过拟合，需要 executor/validator
   分离和 sanitized feedback loop。
3. 清晰可并行的模块应该程序化并行执行，而不是依赖用户显式要求
   subagent 或 skill。

项目定位应是面向 coding agent 的覆盖式搜索、执行/验证隔离和并行执行
治理层，而不是通用 multi-agent runtime。

## 2. Project Goals

### 核心工作流目标

- 当 Codex 或 coding agent 需要资料时，默认搜索范围要明显扩大。
- 研究型任务应由 CoveragePlan、SearchEngineRegistry、EvidenceLedger 和
  coverage gate 控制，而不是模型自觉认为查够了。
- 任何有合理非零可能包含相关信息的 bucket 都应被搜索、记录 no-signal，
  或明确 excluded。
- executor 必须产出可审计 artifact，不能只说改好了。
- validator 与 executor 必须隔离，并形成实现、验证、sanitized feedback、
  修复、再验证的循环。
- 清晰独立模块应有 path scope、shared contract、merge gate，并程序化并行。

### Diagnostics 的作用

Diagnostics 不是产品目标本身，而是用于判断 runner 策略和 SDK worker
可靠性。它衡量并行度、bucket difficulty、prompt width、transient retry、
no-progress taxonomy、all_required parallel 可行性和 strict SDK worker 可靠性。

all-parallel stress 已经提供阶段性证据：all_parallel 在小样本中比
baseline concurrency `3` 更快、更稳。all_parallel completedRate `1`、
medianDurationMs `115798`、averageCoverageScore `100`；baseline
completedRate `0.8571`、medianDurationMs `522481`、averageCoverageScore `99`。

### Hidden Validation

Hidden validation 用来防止 executor 针对公开 tests 或 testcase 过拟合。
目标是让 validator 运行 executor 看不到的 hidden/private checks，只返回
可修复但不泄题的 sanitized feedback。当前 hidden validator runner 不应被
写成已完成，除非 repo 证据验证。

### Research Buckets / SDK Threads / Isolation

- Research buckets 是搜索覆盖单元。
- SDK threads 是 strict programmatic multi-worker research 的主要后端方向。
- App subagents 当前暂时弃用为 hard execution backend。
- Isolation harness 要避免旧 `.agent` 状态、current pointer、SDK session、
  diagnostics output 污染。

## 3. Current Architecture Map

写实现前必须由 Codex 再次核对路径。旧上下文中的架构地图：

- CLI：route、research、report、eval coverage、diagnostics、validate 和未来
  research request。
- Flag parser：typed flags，避免 agent-facing CLI 歧义。
- Router / LLM Router：语义路由到 direct answer、research、implementation、
  validation-sensitive implementation、parallel modules、hardflow maintenance、
  router_failed、clarify 或 bypass。
- CoveragePlan：把 router output 转成 source buckets、perspectives、
  research questions、expected engines、budget 和 gates。
- SearchEngineRegistry：记录 official docs、GitHub、academic、package
  registry、security、community、blogs、competitors、local repo、
  codex_default_discovery 等 engines。
- EvidenceLedger：记录 evidence item，并长期支持 claim anchors。
- Research orchestrator：负责 router trace、coverage/source matrix、runner mode、
  report skeleton、SDK/app/manual modes 和 evidence backfill。
- SDK research runner：负责 strict programmatic workers、heartbeat、checkpoint、
  partial evidence、retry、progress taxonomy 和 diagnostics metrics。
- Diagnostics isolation harness：独立 repo/home/runId、禁止 latest/current shortcut、
  禁止 cross-variant thread reuse，并检测 contamination。
- Reports / coverage eval：区分 runner_mode、evidence_mode、
  programmaticTrigger、programmaticMultiAgent、subagent_status、
  sdk_worker_status 和 coverage_score。
- Hidden validation：未来模块包括 hidden validator runner、command adapter、
  private store、isolated workspace、sanitizer、regression bank、final holdout。
- Parallel modules：负责 path_scope、shared contracts、parallel workers、
  merge gate 和 full validation。

## 4. Glossary

- bucket：信息源类别。
- required bucket：必须 evidence、no-signal 或 excluded with reason 的 bucket。
- all_required parallel：所有 required buckets 同时跑。
- baseline concurrency：历史对照并发值，通常为 `maxConcurrentBuckets=3`。
- transient retry：对 TLS EOF、ECONNRESET、socket hang up、ETIMEDOUT、
  EAI_AGAIN、rate limit 等 transient 失败做 retry。
- progress taxonomy：activityProgress、artifactProgress、semanticProgress。
- checkpoint nudge：worker 有 activity 但无 artifact 时要求写 checkpoint。
- contaminationDetected：实验污染检测结果。
- strict_programmatic：必须用 SDK threads 或 deterministic runner，不 fallback 到
  App/manual/AGENTS/skill。
- sdk_threads：Codex SDK 程序化 worker backend。
- manual fallback：手工/App/Web 搜索后通过 report CLI 回填 evidence。
- AGENTS/skill fallback：软提示行为，不应作为 hard execution。
- App subagents：当前暂时弃用为 strict backend。
- hidden validator：隔离运行 hidden validation，只返回 sanitized summary。
- computed confidence：未来可能做的 router confidence，当前不优先。
- adaptive concurrency：根据 telemetry 自适应并发，当前不优先。

## 5. Important Decisions

- 项目聚焦三件事：扩大搜索、防 executor 过拟合、自动并行独立模块。Status:
  confirmed。
- 搜索策略应 aggressive/exhaustive。Status: confirmed as user preference。
- all_required 必须成为默认方向。Status: confirmed as user policy direction;
  implementation uncertain。
- 不应继续大量并发实验。Status: confirmed current direction。
- App subagents 暂时弃用。Status: confirmed current direction。
- SDK threads 是 strict backend。Status: confirmed direction。
- hidden validator runner 是未来高优先级，但当前尚未证明完成。Status: planned。
- computed confidence 暂不做。Status: confirmed current deprioritization。
- 后续产品化需要 multi-provider flexibility。Status: future direction。

## 6. Tried Or Ruled Out

- 不再继续大量并发实验。
- 不再优先 prompt-width diagnostic。
- 不再优先 bucket difficulty diagnostic，除非真实使用暴露问题。
- 不再优先 computed confidence。
- 不让 hidden validator 被更多 SDK diagnostics 阻塞太久。
- 不继续尝试强化 App subagent prompt。
- 不把实验结果自动写成已确认默认实现。
- 不把 literal `all` parser support 混入实验历史。

## 7. Current Hypotheses

- all_required parallel 符合项目目标。
- adaptive concurrency 当前不应优先。
- 完整大矩阵的必要性低。
- router 仍可能漏掉信息源。
- broad shallow probe 可能有价值。
- worker source 数量限制过死会损失价值。
- 多 LLM/provider 支持是未来方向。

## 8. Current Known Evidence

all-parallel stress:

- baseline concurrency `3`: completedRate `0.8571`, medianDurationMs `522481`,
  averageCoverageScore `99`.
- all_parallel concurrency `7`: completedRate `1`, medianDurationMs `115798`,
  averageCoverageScore `100`.
- decision: `durationImprovement=0.7784`, `coverageDelta=1`,
  `stabilityRegression=false`, `recommendation=all_required_parallel_viable`.

SDK retry/progress:

- transient retry recovered network errors。
- no_artifact_progress 和 no_semantic_progress 不是当前主要问题。

App subagents:

- 旧测试显示 App subagents 不可靠，暂时弃用为 strict backend。

Hidden validator:

- 旧 no-code plan 认为现有实现更像 scaffold/not_configured，需要真实 runner。

## 9. User Preferences

- ChatGPT Web 是规划者、架构评审者、实验解释者和 Codex handoff 审阅者。
- Codex 是执行者、测试者、repo 更新者和报告写作者。
- 中文优先。
- 用户愿意用更高成本和更长时间换取更大搜索范围。
- 默认 aggressive/exhaustive，不应保守 optional。
- 用户希望尽量多 worker 并行。
- 用户不喜欢 keyword/rule-based primary classification。
- commit/push 是否允许取决于当前任务，不应盲目。
- Next ChatGPT Question 有用但不应成为无意义仪式；出现时必须包含 source
  priority、known anomalies、expected output format 和 next Codex prompt request。

## 10. Durable Handoff Rules

- 新 ChatGPT 对话应只依赖 repo 文件，不依赖旧 chat。
- Codex report 应包含 summary、commands run、verification、safety checklist、
  files changed、plan path、current state path、output path 和可选 next question。
- 重要任务后更新 `ai/context/CURRENT_STATE.md`。
- CURRENT_STATE stale 时必须标记。
- 决策应标为 confirmed、tentative、obsolete 或 experiment-only。
- AGENTS.md 不应承载长历史，只应指向 durable context。
- 不要把旧对话推断伪装成事实。

## 11. Open Questions

- exhaustive coverage mode 是否已完全实现？
- all_required 是否已成为代码默认？
- worker source 数量策略是否要改成至少 3-5 或弹性？
- 是否已有 source ranking / dedupe？
- 是否需要 broad shallow probe？
- hidden validator runner 真实状态是什么？
- multi-provider abstraction 初始边界是什么？
- Codex 自动 commit/push 条件应多宽？
- 哪些 diagnostics JSON 应长期保留？

## 12. TODO

高优先级：

- 确认或实现 exhaustive coverage mode。
- 确认或实现 all_required as default strict research direction。
- 调整 worker source return policy。
- 明确 SDK threads strict runner 默认行为。
- 维护 repo context，让新 ChatGPT 可直接判断现状。

中优先级：

- Broad shallow probe。
- Hidden validator runner。
- Run state machine。

低优先级：

- Computed confidence。
- App subagents fallback。
- Multi-provider abstraction。
- UI/dashboard。
- 大规模完整 concurrency matrix。
