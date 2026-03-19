# Step 3 样例 Briefs

这个文件夹包含 MVP workflow 使用的短用户 brief 样例。

## 文件列表

1. `agent_variant_comparison.brief.md`
2. `website_conversion_change.brief.md`

## 用途

这些 briefs 可用于：

1. 用更真实的输入验证 planner prompt
2. 验证 recipe 选择保持确定性
3. 驱动 happy-path demo flow

## 说明

1. 这些文件是面向用户的 brief，不是 machine-readable artifacts。
2. planner 应把它们转换成合法的 `plan.json`。
3. metric pack 仍然由 recipe 自动决定，不由用户手工选择。
4. 当前 MVP 仍假设 PostgreSQL 作为数据源。