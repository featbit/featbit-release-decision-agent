# shared

两个子项目之间的数据格式契约。

## 包含内容

| 文件 | 说明 |
|---|---|
| `types.ts` | TypeScript 类型定义（cf-worker 直接 import） |

## 对应关系

| TypeScript (`types.ts`) | C# (`Models/RollupModels.cs`) |
|---|---|
| `FlagEvalEntry` | `MetricAcc` / `FlagEvalRollup.U` 元素 |
| `MetricEntry` | `MetricAcc` struct |
| `FlagEvalRollup` | `FlagEvalRollup` |
| `MetricEventRollup` | `MetricEventRollup` |
| `Paths.*` | `DeltaProcessor.DeltaKeyToRollupKey()` |

## 重要

修改任何格式时，TypeScript 和 C# **两侧必须同步更新**，否则 rollup-service 无法正确解析 cf-worker 写出的 delta 文件。
