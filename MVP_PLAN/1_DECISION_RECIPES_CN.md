# FeatBit Release Decision Recipes

## 用途

这个文件定义 MVP 支持的 decision recipes。

每个 recipe 都要明确系统以下内容：

1. 什么场景适用
2. 支持什么用户意图
3. 用户必须提供什么
4. 系统必须自动生成什么
5. 使用哪些 metrics 和 guardrails
6. 默认 rollout 是多少
7. reviewer summary 应该如何表述

这个文件是 MVP 计划中 Step 1 的事实来源。

## Recipe 选择规则

用户不选择 metrics。

用户只提供目标和边界。

agent 负责选择一个受支持的 recipe。

选中的 recipe 决定：

1. primary metric
2. guardrails
3. rollout default
4. summary framing
5. recipe 特定的 validation rules

## MVP 支持的 Recipes

第一版 MVP 只支持以下两个 recipes：

1. `agent_variant_comparison`
2. `website_conversion_change`

除此之外的 recipe 都不在第一版范围内。

## Recipe 1: agent_variant_comparison

### 适用场景

当用户要比较两个 agent、model、planner、workflow 或实现变体，并且场景是任务驱动的评估时，使用这个 recipe。

典型用户请求：

1. compare planner_a and planner_b
2. 比较两个 coding-agent 策略
3. 在更大 rollout 前测试新的 agent 行为
4. 评估 candidate variant 是否应获得更多流量

### 用户必须提供

1. decision target 或 decision key 的上下文
2. baseline variant 名称
3. candidate variant 名称
4. 希望提升什么结果
5. 如果有，主要边界或风险顾虑

### 系统必须自动生成

1. recipe id: `agent_variant_comparison`
2. primary metric: `task_success_rate`
3. guardrails:
   `avg_cost`
   `p95_latency_ms`
4. default rollout percentage: `10`
5. 当前 data source kind: `postgres`
6. table 由 inspect 得到的客户 schema 或 mapping 决定
7. randomization unit: `task_id`
8. 面向 agent performance decision 的 reviewer summary framing

### Metric Pack

Primary metric:

1. `task_success_rate`

Guardrails:

1. `avg_cost`
2. `p95_latency_ms`

### 决策策略

Recommendation rules:

1. primary metric 提升且没有任何 guardrail fail -> `continue`
2. 任一 guardrail fail -> `pause`
3. primary metric 明显变差 -> `rollback_candidate`
4. 其他情况 -> `inconclusive`

Rollout guidance:

1. `continue` -> `25`
2. `pause` -> current rollout
3. `rollback_candidate` -> `0`
4. `inconclusive` -> current rollout

### 数据假设

批准事件模型中必须包含以下字段：

1. `decision_key`
2. `variant`
3. `task_id`
4. `success`
5. `cost`
6. `latency_ms`
7. `created_at`

### Reviewer Summary Framing

summary 必须说明：

1. candidate variant 是否在 task success 上更好
2. cost 和 latency 是否仍在可接受范围内
3. 下一步推荐的 rollout action 是什么
4. 该结果是确定性的 operational recommendation，不是正式的统计结论

### 该 Recipe 的范围外内容

1. 超过两个 variants
2. 用户自定义 metrics
3. 任意 SQL 或临时分析
4. 广义实验解释

## Recipe 2: website_conversion_change

### 适用场景

当用户要评估一个网站改动，希望提升某类受众的转化，同时不明显伤害另一类受众或既有导航行为时，使用这个 recipe。

典型用户请求：

1. 提升 homepage 的 demo conversion
2. 让目标客户群更快看到正确的信息
3. 提升新访客转化，同时不伤害已有 docs 用户
4. 比较当前 homepage messaging 和 candidate variant

### 用户必须提供

1. 页面或流程范围
2. 目标受众或希望帮助的受众
3. 期望的业务结果
4. 不能被伤害的受众或行为
5. baseline variant 名称
6. candidate variant 名称

### 系统必须自动生成

1. recipe id: `website_conversion_change`
2. primary metric: `task_success_rate`
3. guardrails:
   `avg_cost`
   `p95_latency_ms`
4. default rollout percentage: `10`
5. 当前 data source kind: `postgres`
6. table 由 inspect 得到的客户 schema 或 mapping 决定
7. randomization unit: `task_id`
8. 面向 audience-specific website changes 的 reviewer summary framing

### 这个 Recipe 在 MVP 中的约束

第一版 MVP 不引入独立的网站分析 metric system。

为了保持 runtime 足够小，这个 recipe 暂时复用 MVP 已有的 metric surface：

1. 用 `task_success_rate` 作为 primary outcome proxy
2. 用 `avg_cost` 作为效率 guardrail
3. 用 `p95_latency_ms` 作为响应性 guardrail

这个 recipe 的目的是证明网站改动场景下的 decision workflow 形态，而不是在第一版中交付完整的 web experimentation model。

### Metric Pack

Primary metric:

1. `task_success_rate`

Guardrails:

1. `avg_cost`
2. `p95_latency_ms`

### 决策策略

Recommendation rules:

1. primary metric 提升且没有任何 guardrail fail -> `continue`
2. 任一 guardrail fail -> `pause`
3. primary metric 明显变差 -> `rollback_candidate`
4. 其他情况 -> `inconclusive`

Rollout guidance:

1. `continue` -> `25`
2. `pause` -> current rollout
3. `rollback_candidate` -> `0`
4. `inconclusive` -> current rollout

### 数据假设

批准事件模型中必须包含以下字段：

1. `decision_key`
2. `variant`
3. `task_id`
4. `success`
5. `cost`
6. `latency_ms`
7. `created_at`

### Reviewer Summary Framing

summary 必须说明：

1. candidate experience 是否提升了目标结果
2. 被保护的行为是否出现不可接受的回归迹象
3. 下一步推荐的 rollout action 是什么
4. 该结果是确定性的 operational recommendation，不是正式的统计结论

### 该 Recipe 的范围外内容

1. 第一版中的自由网站 KPI
2. 多页面归因逻辑
3. 按 segment 划分的 analytics pipeline
4. 超出批准 schema surface 的自定义事件模型

## 共享校验规则

这些规则适用于所有 MVP recipes：

1. 必须恰好两个 variants
2. `data_source_kind` 当前必须是 `postgres`
3. 只支持批准 table
4. 只支持批准 metrics
5. randomization unit 必须是 `task_id`
6. 必须提供 time range

## 对实现的直接要求

runtime 和 prompts 必须满足：

1. 先选择 recipe，再生成 plan
2. plan 生成必须由 recipe 驱动，不能 free-form
3. validator 必须强制执行 recipe 定义的 metrics 和 guardrails
4. reviewer summary wording 必须依赖 recipe 类型
5. 后续新增能力应通过新增 recipe 实现，而不是让 metrics 变成用户可配置
