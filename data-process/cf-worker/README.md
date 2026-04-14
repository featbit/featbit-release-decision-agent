# cf-worker

Cloudflare Worker：接收批量事件 + 实验数据查询。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/track` | 接收 SDK batch events |
| POST | `/api/query/experiment` | 查询 A/B 实验结果 |
| GET | `/health` | 健康检查 |

## 本地运行

```bash
npm install
npm run dev          # wrangler dev --remote（使用真实 R2）
npm run type-check   # TypeScript 类型检查
```

## `/api/track` 请求格式

```json
[
  {
    "user": { "keyId": "user-123" },
    "variations": [
      { "flagKey": "my-flag", "variant": "treatment", "timestamp": 1713000000, "experimentId": "exp-1" }
    ],
    "metrics": [
      { "eventName": "checkout", "numericValue": 99.99, "timestamp": 1713000060 }
    ]
  }
]
```

Header: `Authorization: <envId>`

## `/api/query/experiment` 请求格式

```json
{
  "envId": "env-123",
  "flagKey": "my-flag",
  "metricEvent": "checkout",
  "dates": ["2026-04-13", "2026-04-14"]
}
```

## 架构

```
track → PartitionWriterDO
          ├── 内存缓冲 (< 5s)
          ├── DO Storage (durability)
          └── 每10分钟 → R2 delta JSON

query → R2 rollup JSON → 内存计算 → 返回结果
```

> rollup 文件由 `rollup-service` 生成，query 端点依赖它先运行。
