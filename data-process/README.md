# FeatBit Data Process

A/B 实验数据处理管道，分两个子项目：

```
data-process/
├── cf-worker/        # Cloudflare Worker — 事件接收 + 实验查询
├── rollup-service/   # .NET 10 服务 — 每10分钟将 delta 合并进 rollup
└── shared/           # 数据格式契约 — TypeScript 类型 + R2 路径约定
```

## 数据流

```
SDK (batch)
  → POST /api/track  (cf-worker)
  → PartitionWriterDO  缓冲事件，每10分钟写 delta → R2

rollup-service (cron 每10分钟)
  → 读 R2 delta 文件
  → merge 进 rollup JSON
  → 写回 R2，删除 delta

GET /api/query/experiment  (cf-worker)
  → 读 R2 rollup → 内存计算 → 返回实验结果
```

## R2 路径约定

| 类型 | 路径 |
|---|---|
| FE delta | `deltas/flag-evals/{envId}/{flagKey}/{date}/{ts}.json` |
| ME delta | `deltas/metric-events/{envId}/{eventName}/{date}/{ts}.json` |
| FE rollup | `rollups/flag-evals/{envId}/{flagKey}/{date}.json` |
| ME rollup | `rollups/metric-events/{envId}/{eventName}/{date}.json` |

## 快速启动

```bash
# cf-worker (本地)
cd cf-worker && npm install && npx wrangler dev --remote

# rollup-service (本地)
cd rollup-service && dotnet run
```
