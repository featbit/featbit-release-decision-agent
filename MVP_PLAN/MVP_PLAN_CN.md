# FeatBit Release Decision MVP 计划

## 目标

构建一个最小可用的 release decision MVP，让 agent 能够：

1. 接收用户目标与约束
2. 将输入映射到受支持的 decision recipe
3. 生成 `plan.json` 和 `featbit-actions.json`
4. 复用现有 FeatBit 工具执行 rollout，或在不可用时回退到 dry-run
5. 在用户环境中运行受批准的 measurement templates
6. 输出确定性的 recommendation 和适合 reviewer 阅读的 summary

## 不可违反的规则

1. 用户提供目标和边界，系统提供 metrics、guardrails、rollout defaults 和 decision method。
2. `plan.json` 必须由系统生成。
3. 只能运行批准过的模板，不能运行 LLM 生成的 SQL。
4. 必须复用现有 FeatBit control-plane 能力，不能重做。
5. reviewer 输出必须让非专业人员也能理解。
6. 原始数据库凭据不能进入 prompts、artifacts 或 logs。
7. 数据库访问应优先通过环境变量引用或受信本地 connector，而不是在 agent 上下文中直接传入原始连接字符串。

## 范围

### 包含

1. `agent_variant_comparison` recipe
2. `website_conversion_change` recipe
3. 数据源适配器抽象层
4. PostgreSQL 作为当前最小支持的适配器
5. `plan.json`
6. `featbit-actions.json`
7. `catalog.json`
8. `results.json`
9. `summary.md`
10. 包含 `inspect`、`validate-plan`、`run`、`sync-dry-run` 的 `featbit-decision` CLI

### 不包含

1. 统计实验引擎
2. 任意用户自定义 metrics
3. 任意 SQL 生成
4. Web UI
5. 为所有客户数据源预置适配器
6. 自动回滚自动化

## 实现分层

### Agent Skills 与 Workflow

负责：

1. 解释用户意图
2. 选择 recipe
3. 生成结构化 artifacts
4. 决定工具调用顺序
5. 生成 reviewer summary

不负责：

1. metric 计算
2. rollout 执行逻辑
3. 自由 SQL 生成

### featbit-decision Runtime

负责：

1. 加载 recipes
2. 校验 plans
3. 检查 schema
4. 执行批准模板
5. 计算确定性 recommendation
6. 写出 artifacts
7. 通过数据源适配器转发请求

不负责：

1. feature flag CRUD
2. rollout control 实现

### FeatBit MCP 或 CLI

负责：

1. 确保 flag 存在
2. 确保 variants 存在
3. 设置 rollout percentage
4. 在支持时附加 metadata

### Scripts

负责：

1. 跑 demo flow
2. 串联命令
3. 支持本地和 CI 执行

不负责：

1. 核心决策逻辑

## 构建顺序

### Step 1: 定义 Decision Recipes

交付物：

1. recipe catalog 文档
2. `agent_variant_comparison` recipe 定义
3. `website_conversion_change` recipe 定义
4. 每个 recipe 的 metric pack
5. 每个 recipe 的 guardrail pack
6. 每个 recipe 的 rollout default
7. 每个 recipe 的 reviewer summary framing

完成标准：

1. 每个支持的用户目标都能映射到一个 recipe
2. recipe 定义可以完整决定 metrics 和 guardrails
3. 不需要用户自己配置 metrics

### Step 2: 定义 System Contracts

交付物：

1. `plan.json` contract
2. `featbit-actions.json` contract
3. `catalog.json` contract
4. `results.json` contract
5. `summary.md` contract
6. 两个 recipe 的 sample artifacts

完成标准：

1. 所有必填字段都已定义
2. artifacts 稳定且 machine-readable
3. plan 生成由 recipe 驱动

### Step 3: 搭建 featbit-decision 骨架

交付物：

1. 项目结构
2. CLI 入口
3. models
4. file store
5. `inspect`、`validate-plan`、`run`、`sync-dry-run` 命令骨架

完成标准：

1. 命令可非交互执行
2. 输入输出路径稳定
3. 命令可被 scripts 或 agent session 调用

### Step 4: 先实现 validate-plan

交付物：

1. recipe-aware plan validator
2. unsupported recipe 的校验错误
3. unsupported metrics 和 guardrails 的校验错误
4. time range、table、variant 结构、randomization unit 的校验错误

完成标准：

1. invalid plans 能确定性失败
2. valid plans 无需人工修正即可通过
3. validator 强制执行 recipe 约束，而不是 free-form config

### Step 5: 第二个实现 sync-dry-run

交付物：

1. 从 plan 转为 `featbit-actions.json`
2. dry-run fallback artifact
3. ensure-flag、ensure-variants、set-rollout 的 action 结构

完成标准：

1. 没有 direct FeatBit access 时 workflow 仍可继续
2. control intent 可审计

### Step 6: 第三个实现 run

交付物：

1. metric template registry
2. 批准的 SQL templates
3. query execution pipeline
4. result aggregation
5. recommendation engine
6. `results.json`
7. `summary.md`

完成标准：

1. 只能执行批准模板
2. 结果具有确定性
3. recommendation 只能是 `continue`、`pause`、`rollback_candidate`、`inconclusive`
4. summary 适合非专业 reviewer 阅读

### Step 7: 第四个实现 inspect

交付物：

1. 基于数据源适配器抽象的 PostgreSQL schema inspector
2. `catalog.json` 输出
3. 可选的简单 mapping 支持

完成标准：

1. 能校验必需的 tables 和 columns
2. 不支持的 schema 会被明确拒绝

### Step 8: 增加 Agent Workflow Files

交付物：

1. planner system prompt
2. summary system prompt
3. control policy prompt
4. 精确执行顺序的 workflow 文档

完成标准：

1. agent 可以稳定地根据用户 brief 生成 artifacts
2. direct execution 和 dry-run 路径都有文档说明

### Step 9: 增加 Demo 与 Tests

交付物：

1. happy-path demo flow
2. 每个 recipe 的 sample brief
3. invalid-plan tests
4. recommendation rule tests
5. dry-run fallback test

完成标准：

1. demo 可重复运行
2. failure modes 易于理解
3. 核心决策行为有测试覆盖

## 当前立即执行的任务

按顺序执行：

这个计划中的核心 MVP 任务已经完成。

如果继续做，下一阶段应归类为 production hardening，而不是 MVP 定义本身。

## MVP 完成标准

当以下条件全部满足时，MVP 完成：

1. 用户能表达目标，而不需要选择技术 metrics
2. 系统能把目标映射到受支持的 recipe
3. agent 能生成 `plan.json` 和 `featbit-actions.json`
4. `featbit-decision validate-plan` 能确定性拒绝 invalid plans
5. `featbit-decision run` 能执行批准模板并写出 `results.json`
6. workflow 能复用现有 FeatBit 工具执行 rollout，或安全回退到 dry-run
7. `summary.md` 适合非专业 reviewer 阅读

## 更新规则

如果优先级或产品理解发生变化，先更新这个文件，再更新实现。
