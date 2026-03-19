# Step 2 样例 Artifacts

这个文件夹包含 MVP 计划 Step 2 的 machine-readable 样例 artifacts。

## 文件列表

1. `agent_variant_comparison.plan.json`
2. `agent_variant_comparison.featbit-actions.json`
3. `agent_variant_comparison.results.json`
4. `agent_variant_comparison.summary.md`
5. `website_conversion_change.plan.json`
6. `website_conversion_change.featbit-actions.json`
7. `website_conversion_change.results.json`
8. `website_conversion_change.summary.md`

## 用途

这些文件可作为以下工作的初始参考：

1. validator 行为定义
2. runtime serialization 输出
3. prompt 的目标输出结构
4. demo flow 搭建

## 说明

1. 这些样例遵循 `../2_SYSTEM_CONTRACTS.md` 中定义的 contracts。
2. 这些 sample plans 当前只演示 PostgreSQL 适配器。
3. schema 预期来自用户提供的连接信息后动态 inspect，而不是预先声明固定 warehouse 形态。
4. website recipe 目前仍复用 MVP 的共享 metric surface，还没有引入独立的网站分析模型。
5. 这些文件用于实现和校验示例，不代表生产数据。
