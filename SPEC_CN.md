# FeatBit Release Decision Plugin
## 生产可用 MVP 规格 v0.3

---

## 1. 产品判断

FeatBit 不应该再做一个独立 coding agent。

FeatBit 应该做的是一个面向现有 coding agents 的 release decision plugin / toolkit。

这个产品要帮助 Claude Code、GitHub Copilot、Cursor 等 agent 完成三件事：

- 把 decision inputs 转成结构化计划
- 通过 FeatBit 现有能力执行 rollout 控制
- 在不暴露不必要原始数据的前提下结合 system signals 和 human context 完成判断并给出确定性推荐

这个 MVP 的目标是以尽量小、可审计、可生产使用的方式跑通闭环。

术语统一如下：

- `decision inputs`：brief、pull request、ticket 以及其他进入决策流程的输入
- `system signals`：metrics、measurement data、alerts、logs 等系统可观测信号
- `human context`：市场变化、公司决策、战略优先级等人工补充的真实世界上下文

---

## 2. 产品定义

当前阶段的产品名称是：

**FeatBit Release Decision Plugin**

仓库名可以保持不变，但这个 MVP 的形态不是 standalone agent runtime。

它是一个工具层，由三部分组成：

- 现有 coding agents 负责 orchestration
- FeatBit 现有 control-plane tooling 负责 flag 与 rollout 操作
- 新的 `featbit-decision` 负责 measurement、validation 与 recommendation

这个产品必须增强 FeatBit 现有 feature flag infrastructure 的价值，而不是替代它。

MVP 的商业逻辑是：

- feature flag infrastructure 仍然是核心生产系统和可收费 control plane
- release decision plugin 提升这层基础设施的价值、粘性和工作流地位
- decisioning 是叠加在 feature flag infrastructure 之上的扩展层，不是脱离现有业务的单独故事

---

## 3. 核心目标

这个 production-ready MVP 必须证明一个完整闭环：

> PM 或工程师可以用 decision inputs 描述一个 release decision，coding agent 能把它转成有效计划，通过 FeatBit 现有能力执行或准备 rollout 操作，在用户自己的环境里结合 system signals 和 human context 完成判断，并生成一个可供人工审阅的推荐结论，用于实验放量、安全发布或快速回滚。

成功标准是：这个 workflow 在真实工程环境中可用，边界清晰，行为确定，且敏感数据暴露最小。

---

## 4. 产品边界

这个产品不能滑向一个通用 experimentation platform。

像 GrowthBook 这类传统实验平台，重心通常在：

- 平台内配置实验
- metric system 和 fact-table modeling
- 通用统计分析与 slicing
- 在平台 UI 中消费实验结果

FeatBit Release Decision Plugin 的重心不同。

它的首要任务是帮助 coding agent 连接以下几件事，从而做出 operational release decision：

- repo 与代码上下文
- decision inputs
- FeatBit 现有 release-control primitives
- 用户环境中的 system signals
- human context
- 确定性的 release recommendation logic

因此这个产品优化的是：

- agent-native workflow，而不是 platform-native workflow
- release decisioning，而不是通用 experiment analytics
- 私有环境执行，而不是大而全的中心化分析
- 可审计的 operational artifacts，而不是平台内丰富分析 UI

如果未来某个功能只是让产品更像通用实验平台，却不能提升 agent-driven release decision 的质量、安全性或可执行性，那它就不属于这个产品。

---

## 5. 生产可用 MVP 范围

### 5.1 包含

- coding agent 将 brief 转成 `plan.json` 的 workflow
- 复用 FeatBit CLI、MCP、Skills 或 SDK 执行 release-control actions
- 一个可生产使用的 `featbit-decision` 命令面
- 固定的 metric templates
- 确定性的 recommendation logic
- 面向审计和自动化的 machine-readable artifacts
- 本地 / 私有环境的数据面执行模型
- 当无法直接访问 FeatBit control plane 时的 dry-run 行为

### 5.2 不包含

- standalone agent runtime
- web UI
- 任意 SQL 生成
- 通用 analytics platform
- 首个 production MVP 之外的多仓库支持
- 统计实验引擎
- 自动回滚自动化
- 在 decision runtime 中重做 feature flag CRUD 或 rollout 逻辑

---

## 6. 目标用户体验

### 用户 brief

> Compare planner_a and planner_b for coding-agent tasks.  
> Primary metric: task_success_rate.  
> Guardrails: avg_cost, p95_latency_ms.  
> Start with 10% rollout.  
> Decision key: coding_agent_planner.

### 预期流程

1. coding agent 读取 brief。
2. coding agent 写出 `plan.json`。
3. coding agent 写出 `featbit-actions.json`。
4. coding agent 使用 FeatBit 现有工具确保 decision flag 和 variants 存在。
5. 如果可以直接访问 FeatBit，则应用 rollout。
6. 如果 catalog 缺失或过期，则运行 `featbit-decision inspect`。
7. 运行 `featbit-decision validate-plan`。
8. 运行 `featbit-decision run`。
9. 写出 `results.json` 和 `summary.md`。
10. 给出一个 next action：`continue`、`pause`、`rollback_candidate` 或 `inconclusive`。

---

## 7. 架构

```text
User brief
  -> Coding agent
      -> generate plan.json
      -> generate featbit-actions.json
      -> execute FeatBit control actions through existing tooling when available
      -> call featbit-decision inspect
      -> call featbit-decision validate-plan
      -> call featbit-decision run
      -> read results.json
      -> generate summary.md
      -> propose next rollout action
```

### 7.1 职责划分

#### Orchestration Layer

由 coding agents 负责。

职责：

- 理解自然语言 brief
- 读取 repo 上下文
- 产出结构化 artifacts
- 选择工具调用
- 向用户展示 summary

#### Control Plane

由 FeatBit 现有工具负责。

职责：

- 确保 flag 存在
- 确保 variants 存在
- 更新 rollout 百分比
- 在支持时更新元数据

优先执行路径：

1. FeatBit MCP / Skills
2. FeatBit CLI
3. FeatBit SDK
4. 只输出 dry-run artifact

#### Measurement Plane

由 `featbit-decision` 负责。

职责：

- inspect 支持的 schema
- validate plan
- 执行固定 metric templates
- 计算确定性 recommendation
- 输出结构化结果

---

## 8. Trust Boundary 与 Data Residency

### 8.1 数据处理原则

除了 feature flag 操作必需的最小 control-plane 数据之外，decision data 必须留在用户环境中。

### 8.2 可以离开用户环境的数据

- flag 和 rollout 操作本来就需要的 FeatBit control-plane requests
- workflow 主动生成的 machine-readable artifacts
- 聚合后的 decision outputs，例如 metric values、recommendation 和 summary

### 8.3 必须留在用户环境中的数据

- event-level 原始 warehouse 数据
- control-plane 不需要的任意 codebase telemetry
- warehouse credentials
- 由 LLM 自由生成的 SQL 执行逻辑

### 8.4 产品规则

LLM 可以基于 plan、catalog 和聚合结果进行推理。
LLM 不能生成可执行 SQL。
measurement runtime 只能执行仓库中预置的 approved templates。

---

## 9. FeatBit 现有能力复用策略

### 9.1 Hard Rule

只要 FeatBit 已经通过 CLI、MCP、Skills 或 SDK 提供了某项能力，plugin 就必须复用它。

### 9.2 不重做 Feature Flag Control

新的 runtime 不能去实现已有 FeatBit tooling 已经提供的 feature-flag CRUD 或 rollout 逻辑。

### 9.3 MVP 所需最小 control-plane 操作

- 确保 decision flag 存在
- 确保恰好两个 variants 存在
- 设置初始 rollout 百分比
- 在支持时附加 description、notes 或 tag 等元数据

### 9.4 Fallback 行为

如果不能直接调用 FeatBit，workflow 仍然必须生成 `featbit-actions.json` 并继续完成 measurement 和 recommendation。

MVP 不能因为 control-plane 无法直接访问就整体失败。

---

## 10. 支持的 Decision Model

### 10.1 初始仓库支持

首个 production-ready MVP 只支持 ClickHouse。

### 10.2 初始表假设

支持的基础表是 `decision_events`。

```sql
CREATE TABLE decision_events
(
  decision_key String,
  variant String,
  task_id String,
  success UInt8,
  cost Float64,
  latency_ms UInt32,
  created_at DateTime
)
ENGINE = MergeTree
ORDER BY (decision_key, created_at, task_id);
```

### 10.3 Mapping 支持

可以支持简单的 mapping file 来做字段映射。
不做 generalized schema inference。

### 10.4 支持的 randomization unit

这个 MVP 只支持 `task_id`。

---

## 11. 支持的 Metrics

这个 MVP 只支持三个 metrics：

### `task_success_rate`

- 定义：`sum(success) / countDistinct(task_id)`
- 方向：越高越好

### `avg_cost`

- 定义：`avg(cost)`
- 方向：越低越好

### `p95_latency_ms`

- 定义：`quantileExact(0.95)(latency_ms)`
- 方向：越低越好

### SQL 规则

所有 SQL 必须来自固定仓库模板。
coding agent 不能为 measurement runtime 生成可执行 SQL。

---

## 12. 确定性 Recommendation Engine

recommendation engine 只做 deterministic logic。

### Guardrail Thresholds

- `avg_cost` 回归超过 5% 视为 fail
- `p95_latency_ms` 回归超过 10% 视为 fail

### Recommendation Rules

- primary metric 提升且无 guardrail fail => `continue`
- 任一 guardrail fail => `pause`
- primary metric 明显变差 => `rollback_candidate`
- 其他情况 => `inconclusive`

### Rollout Guidance

- `continue` => 25
- `pause` => current rollout
- `rollback_candidate` => 0
- `inconclusive` => current rollout

### 输出约束

recommendation 是 operational suggestion，不是 statistical conclusion。

---

## 13. Runtime Surface

生产 runtime 名称是：

```bash
featbit-decision
```

它必须保持小、可脚本化、可确定、可自动化。

### 13.1 `inspect`

用途：inspect ClickHouse schema 并写出 `catalog.json`

```bash
featbit-decision inspect --connection "$CLICKHOUSE_DSN" --out ./out/catalog.json
```

### 13.2 `validate-plan`

用途：根据支持字段与 catalog 校验 `plan.json`

```bash
featbit-decision validate-plan \
  --plan ./out/plan.json \
  --catalog ./out/catalog.json
```

最小校验规则：

- 恰好两个 variants
- 只能使用支持的 metrics
- randomization unit 只能是 `task_id`
- table 必须存在
- time range 必须存在

### 13.3 `run`

用途：执行固定 metric templates 并生成 `results.json`

```bash
featbit-decision run \
  --plan ./out/plan.json \
  --catalog ./out/catalog.json \
  --connection "$CLICKHOUSE_DSN" \
  --out ./out/results.json
```

### 13.4 `sync-dry-run`

用途：在无法直接执行 FeatBit 操作时写出 dry-run payload

```bash
featbit-decision sync-dry-run \
  --plan ./out/plan.json \
  --out ./out/featbit-actions.json
```

---

## 14. Data Contracts

### 14.1 `plan.json`

```json
{
  "decision_key": "coding_agent_planner",
  "variants": ["planner_a", "planner_b"],
  "randomization_unit": "task_id",
  "primary_metric": "task_success_rate",
  "guardrails": ["avg_cost", "p95_latency_ms"],
  "rollout_percentage": 10,
  "warehouse": "clickhouse",
  "table": "decision_events",
  "time_range": {
    "start": "2026-03-01T00:00:00Z",
    "end": "2026-03-07T00:00:00Z"
  },
  "notes": "Compare planner strategies for coding-agent tasks."
}
```

### 14.2 `featbit-actions.json`

```json
{
  "decision_key": "coding_agent_planner",
  "actions": [
    {
      "type": "ensure_flag",
      "flag_kind": "multi_variant"
    },
    {
      "type": "ensure_variants",
      "variants": ["planner_a", "planner_b"]
    },
    {
      "type": "set_rollout",
      "percentage": 10
    }
  ]
}
```

### 14.3 `catalog.json`

```json
{
  "warehouse": "clickhouse",
  "tables": [
    {
      "name": "decision_events",
      "columns": [
        { "name": "decision_key", "type": "String" },
        { "name": "variant", "type": "String" },
        { "name": "task_id", "type": "String" },
        { "name": "success", "type": "UInt8" },
        { "name": "cost", "type": "Float64" },
        { "name": "latency_ms", "type": "UInt32" },
        { "name": "created_at", "type": "DateTime" }
      ]
    }
  ],
  "metric_candidates": [
    "task_success_rate",
    "avg_cost",
    "p95_latency_ms"
  ]
}
```

### 14.4 `results.json`

```json
{
  "decision_key": "coding_agent_planner",
  "primary_metric": {
    "name": "task_success_rate",
    "baseline_variant": "planner_a",
    "candidate_variant": "planner_b",
    "baseline_value": 0.61,
    "candidate_value": 0.648,
    "absolute_delta": 0.038,
    "relative_delta": 0.0623
  },
  "guardrails": [
    {
      "name": "avg_cost",
      "baseline_value": 0.42,
      "candidate_value": 0.429,
      "relative_delta": 0.0214,
      "status": "pass"
    },
    {
      "name": "p95_latency_ms",
      "baseline_value": 1800,
      "candidate_value": 1785,
      "relative_delta": -0.0083,
      "status": "pass"
    }
  ],
  "recommendation": "continue",
  "recommended_next_rollout_percentage": 25,
  "reasoning": [
    "Primary metric improved",
    "No guardrail regression detected"
  ]
}
```

### 14.5 `summary.md`

```md
# Release Decision Summary

Decision key: `coding_agent_planner`

## Result
`planner_b` improves task success rate by **6.2%** over `planner_a`.

## Guardrails
- avg_cost: pass (+2.1%)
- p95_latency_ms: pass (-0.8%)

## Recommendation
Continue rollout to **25%**.

## Note
This recommendation is based on rule-based metric comparison in the MVP and is not a formal statistical conclusion.
```

---

## 15. Prompt 与 Workflow 要求

仓库必须提供 prompt 和 workflow 文档，用来指导 coding agent，但不能替代它。

### `planner-system.md`

必须要求 agent：

- 为 `plan.json` 只输出有效 JSON
- 只能使用支持的 metrics
- 默认 warehouse 为 `clickhouse`
- 默认 table 为 `decision_events`
- randomization unit 使用 `task_id`
- 输出 `featbit-actions.json` 表达 control-plane intent

### `summary-system.md`

必须要求 agent：

- 用简洁业务语言总结结果
- 不夸大统计确定性
- 包含 rule-based output note

### `featbit-control-policy.md`

必须要求 agent：

- 优先使用 FeatBit 现有工具处理 flag CRUD 和 rollout
- 不在新代码中重做这些操作
- 当 direct execution 不可用时输出 dry-run artifacts

### `claude-workflow.md` 或等价 workflow 文件

必须描述标准操作顺序：

1. 读 `brief.md`
2. 生成 `plan.json`
3. 生成 `featbit-actions.json`
4. 执行 FeatBit control-plane actions（如果可用）
5. 运行 `featbit-decision inspect`
6. 运行 `featbit-decision validate-plan`
7. 运行 `featbit-decision run`
8. 生成 `summary.md`

---

## 16. 仓库结构

```text
/featbit-release-decision-agent
  /src
    /DecisionCli
      Program.cs
      Commands/
        InspectCommand.cs
        ValidatePlanCommand.cs
        RunCommand.cs
        SyncDryRunCommand.cs

    /Core
      Models/
        ExperimentPlan.cs
        DataCatalog.cs
        QueryResult.cs
        EvaluationResult.cs
        FeatBitActionPlan.cs
      Services/
        PlanValidator.cs
        MetricTemplateRegistry.cs
        RecommendationEngine.cs
        FileStore.cs

    /Data
      /Postgres
        PostgresConnectionFactory.cs
        PostgresDataSourceAdapter.cs

    /Templates
      Sql/
        task_success_rate.postgres.sql
        avg_cost.postgres.sql
        p95_latency_ms.postgres.sql

  /skills
    /release_decision.website_change
      SKILL.md
    /release_decision.agent_variant
      SKILL.md

  /slash-commands
    configure-data-source.md
    inspect-data-source.md
    run-release-decision.md

  /toolkit
    README.md

  /prompts
    planner-system.md
    summary-system.md
    claude-workflow.md
    featbit-control-policy.md

  /examples
    /agent_variant_comparison
      brief.md
    /website_conversion_change
      brief.md
    demo.ps1
    demo-flow.md
    demo-commands.sh

  /out
    .gitkeep

  README.md
  WHITE_PAPER.md
```

---

## 17. Production Readiness Requirements

只有满足以下条件，这个 MVP 才算 production-ready：

- 命令行为确定
- 对 invalid plans 和 unsupported schemas 有明确报错
- 不依赖 LLM 生成 SQL
- 每次 decision run 都输出可审计 artifacts
- 当 FeatBit control-plane execution 不可用时有安全 fallback
- orchestration、control-plane execution 与 measurement 分层清晰
- warehouse access 使用环境变量或等价安全凭证方式
- 能在 coding-agent session 或 automation wrapper 中非交互运行

---

## 18. Acceptance Criteria

满足以下条件时，production-ready MVP 才算完成：

- coding agent 能把 brief 转成 `plan.json`
- coding agent 能生成 `featbit-actions.json`
- workflow 能复用 FeatBit 现有 tooling 处理 control-plane tasks
- `featbit-decision inspect` 能写出 `catalog.json`
- `featbit-decision validate-plan` 能确定性拒绝不支持的 plan
- `featbit-decision run` 能执行三个支持的 metrics 并写出 `results.json`
- coding agent 能生成 `summary.md`
- decision runtime 内没有重做 feature-flag CRUD 或 rollout logic
- workflow 可以在私有 decision data 留在用户环境中的前提下运行

---

## 19. MVP 最终定义

这个 MVP 是：

> 一个面向 coding agents 的 release decision plugin，它把 FeatBit 现有 control-plane tooling 与一个面向 warehouse 的确定性 measurement runtime 组合起来。

它不是：

- 新的 flag platform
- 通用 analytics product
- standalone agent runtime
- 统计 experimentation platform

它是当前最小、但可生产使用的一层，让 coding agents 能在 FeatBit 之上完成 plan、execute、measure 和 summarize release decisions。