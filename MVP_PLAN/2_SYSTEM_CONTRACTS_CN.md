# FeatBit Release Decision System Contracts

## 用途

这个文件定义 Step 2 需要遵守的 contracts，供 runtime、prompts、scripts 和 examples 共同使用。

目标是让 artifacts 稳定、machine-readable，并且完全由 recipe 驱动。

## Contract 规则

1. 所有 contracts 都必须由 recipe 驱动。
2. `plan.json` 必须由系统生成。
3. 所有 artifact 字段都必须明确。
4. 第一版 MVP 使用数据源适配器抽象。
5. PostgreSQL 是当前最小支持的适配器。
6. 第一版 MVP 只支持恰好两个 variants。
7. 原始数据库凭据不能出现在 artifacts 中。

## 1. plan.json

### 用途

表示某一次 decision run 的系统生成执行计划。

### 必填字段

1. `recipe_id`
2. `decision_key`
3. `variants`
4. `randomization_unit`
5. `primary_metric`
6. `guardrails`
7. `rollout_percentage`
8. `data_source_kind`
9. `table`
10. `time_range.start`
11. `time_range.end`

### 可选字段

1. `notes`
2. `user_goal`
3. `boundaries`
4. `page_scope`
5. `target_audience`
6. `protected_audience`

### 凭据处理

1. `plan.json` 不能包含 connection string、username、password、token 或 secret reference 的具体值。
2. 数据库访问应在运行时通过 `--connection-env` 或其它受信执行侧机制提供。
3. 原始凭据不属于 artifact contract 的一部分。

### 校验规则

1. `recipe_id` 必须是受支持的 recipe
2. `variants` 必须恰好包含两个值
3. `randomization_unit` 必须是 `task_id`
4. `primary_metric` 必须与所选 recipe 一致
5. `guardrails` 必须与所选 recipe 一致
6. `data_source_kind` 当前必须是 `postgres`
7. `table` 必须存在于 inspect 得到的 catalog 中，或通过 mapping 规则提供
8. `time_range` 必须存在

## 2. featbit-actions.json

### 用途

表示从合法 plan 推导出来的 control-plane intent。

### 必填字段

1. `decision_key`
2. `actions`

### 必需 actions

1. `ensure_flag`
2. `ensure_variants`
3. `set_rollout`

### 校验规则

1. actions 必须能从 `plan.json` 推导出来
2. `ensure_variants` 必须与 plan 中的 variants 完全一致
3. `set_rollout` 必须与 plan 中的 rollout percentage 一致

## 3. catalog.json

### 用途

表示 runtime 可用的客户数据源 schema 检查结果。

### 必填字段

1. `data_source_kind`
2. `tables`
3. `metric_candidates`

### 必需表数据

1. `name`
2. `columns`

### 必需列数据

1. `name`
2. `type`

### 校验规则

1. `data_source_kind` 当前必须是 `postgres`
2. 必需 table 必须存在
3. recipe 需要的列必须存在

## 4. results.json

### 用途

表示某一次 decision run 的 machine-readable evaluation 输出。

### 必填字段

1. `recipe_id`
2. `decision_key`
3. `primary_metric`
4. `guardrails`
5. `recommendation`
6. `recommended_next_rollout_percentage`
7. `reasoning`

### Primary Metric Object

必须包含：

1. `name`
2. `baseline_variant`
3. `candidate_variant`
4. `baseline_value`
5. `candidate_value`
6. `absolute_delta`
7. `relative_delta`

### Guardrail Object

必须包含：

1. `name`
2. `baseline_value`
3. `candidate_value`
4. `relative_delta`
5. `status`

### Recommendation 规则

`recommendation` 只能是以下之一：

1. `continue`
2. `pause`
3. `rollback_candidate`
4. `inconclusive`

## 5. summary.md

### 用途

表示面向 reviewer 的 operational summary。

### 必须回答

1. 系统推荐做什么
2. 为什么这么推荐
3. 检查了哪些风险
4. 下一步建议的 rollout action 是什么

### 必需约束

1. 文案必须简短且面向操作
2. 不能声称正式统计显著性
3. wording 必须体现所选 recipe 的语境

## Sample Artifact 要求

Step 2 必须为两个 recipes 都提供 sample artifacts。

最小样例集：

1. 一个 `agent_variant_comparison` 的 sample `plan.json`
2. 一个 `website_conversion_change` 的 sample `plan.json`
3. 一个 sample `featbit-actions.json`
4. 一个 sample `results.json`
5. 一个 sample `summary.md`

## 对实现的直接要求

1. validator 逻辑应直接绑定这些 contracts
2. prompt 输出必须精确对齐这些 contracts
3. runtime serialization 必须使用这些字段名，不能漂移
4. 下一步应在 examples 或专用 sample 目录中加入 sample artifacts
