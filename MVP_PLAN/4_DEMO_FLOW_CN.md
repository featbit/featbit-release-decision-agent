# Demo Flow

这个文档定义了一个可重复执行的 MVP happy-path demo。

## 目标

展示一个用户 brief 如何依次经过 inspect、planning、validation、确定性评估，以及 dry-run 控制输出。

## 前置条件

1. 已安装 .NET 10 SDK。
2. 可访问 PostgreSQL 数据库。
3. 数据库连接保存在环境变量中，例如 `FB_DECISION_PG`。
4. 被 inspect 的表包含 MVP 需要的列。

## 输入

使用以下任一 brief：

1. `examples/agent_variant_comparison/brief.md`
2. `examples/website_conversion_change/brief.md`

## 输出目录

使用本地 artifacts 目录，例如 `artifacts/demo`。

## Demo 步骤

1. Inspect PostgreSQL schema。

```powershell
dotnet run --project src/DecisionCli -- inspect --data-source-kind postgres --connection-env FB_DECISION_PG --out artifacts/demo/catalog.json
```

2. 使用 planner prompt 加上一个 sample brief，产出 `artifacts/demo/plan.json`。

	如果所选表的列名不同，再在校验前向 plan 中补充 `column_mappings`。

3. 校验 plan。

```powershell
dotnet run --project src/DecisionCli -- validate-plan --plan artifacts/demo/plan.json --catalog artifacts/demo/catalog.json
```

4. 执行确定性评估。

```powershell
dotnet run --project src/DecisionCli -- run --plan artifacts/demo/plan.json --catalog artifacts/demo/catalog.json --connection-env FB_DECISION_PG --out artifacts/demo/results.json --summary-out artifacts/demo/summary.md
```

5. 生成 dry-run 的 FeatBit action plan。

```powershell
dotnet run --project src/DecisionCli -- sync-dry-run --plan artifacts/demo/plan.json --out artifacts/demo/featbit-actions.json
```

## Demo 期望输出

1. `catalog.json`
2. `plan.json`
3. `results.json`
4. `summary.md`
5. `featbit-actions.json`

## Demo 完成标准

1. `validate-plan` 不返回错误。
2. `run` 能写出确定性输出文件。
3. `summary.md` 适合非专业 reviewer 阅读。
4. `featbit-actions.json` 能表达可审计的 rollout intent。

## Direct-Control Handoff 假设

这个仓库本身不直接执行 FeatBit mutation。

对 demo 来说，direct control 被视为外部可选能力。默认预期路径是 dry-run，然后交给已有且授权的 FeatBit 工具链处理。

## Demo 中应展示的失败场景

1. unsupported recipe
2. 缺少 required columns
3. 非法 time range
4. 连接环境变量不存在