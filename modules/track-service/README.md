# track-service

.NET 10 Web API. 接收 SDK / Worker / 其他客户端发来的 flag 评估和指标事件，
**内存队列 → 批量写入 ClickHouse**；同时提供一个查询接口，给 stats-service
返回做 Bayesian / Bandit 分析所需的 per-variant 聚合数据。

替代了旧的 `cf-worker`（HTTP 入口 + DO 缓冲 + R2 delta 写入）和
`rollup-service`（每 10 分钟扫 R2 合并 delta），把这两件事合成了一个进程。

---

## 三个职责

```
┌────────────────────────────────────────────────────────────────────┐
│ POST /api/track            ← 批量（同 cf-worker 旧格式）           │
│ POST /api/track/event      ← 单条                                  │
│      │                                                             │
│      ▼                                                             │
│  EventQueue (Channel<EventRecord>, bounded 100k)                   │
│      │                                                             │
│      ▼                                                             │
│  BatchIngestWorker (BackgroundService)                             │
│      │   每 5 秒 或 1000 条，flush                                 │
│      ▼                                                             │
│  ClickHouse: featbit.flag_evaluations / featbit.metric_events      │
│                                                                    │
│ POST /api/query/experiment ← stats-service 来查 per-variant 数据   │
│      │                                                             │
│      ▼                                                             │
│  ClickHouse query (one SQL, JOINs FE+ME by user_key)               │
│                                                                    │
│ GET  /health               ← 云上探针                              │
└────────────────────────────────────────────────────────────────────┘
```

---

## 一次性安装：建库建表

ClickHouse 服务器跑一次：

```bash
clickhouse-client --host <your-host> --secure --user default --password '...' \
  --queries-file sql/schema.sql
```

或者打开 ClickHouse Play UI，把 `sql/schema.sql` 整个粘进去执行。

---

## 配置

通过 `appsettings.json`、`appsettings.Production.json` 或环境变量：

| 环境变量 / appsettings 键 | 默认 | 说明 |
|---|---|---|
| `CLICKHOUSE_CONNECTION_STRING` / `ClickHouse:ConnectionString` | — | 完整 ADO.NET 连接串，见下方示例 |
| `ClickHouse:Database` | `featbit` | DB 名 |
| `ClickHouse:FlagEvaluationsTable` | `flag_evaluations` | 表名 |
| `ClickHouse:MetricEventsTable` | `metric_events` | 表名 |
| `Ingest:ChannelCapacity` | `100000` | 内存队列容量；满了之后丢最新 |
| `Ingest:BatchSize` | `1000` | 攒够这个数量立刻 flush |
| `Ingest:FlushIntervalMs` | `5000` | 不到 batch size 也最多等这么久就 flush |

ClickHouse 连接串示例（HTTPS）：

```
Host=ch.example.com;Port=8443;Username=default;Password=mypw;Protocol=https;Database=featbit
```

HTTP（自建 Azure VM、未配置 TLS 时）：

```
Host=10.0.0.5;Port=8123;Username=default;Password=mypw;Protocol=http;Database=featbit
```

---

## 本地运行

```bash
cd data-process/track-service
export CLICKHOUSE_CONNECTION_STRING="Host=...;Port=8443;Username=default;Password=...;Protocol=https;Database=featbit"
dotnet run
```

服务监听 `http://localhost:5000`（或 `ASPNETCORE_URLS` 指定的端口）。

---

## API

### `POST /api/track`

批量接收 SDK 上报数据。

**Timestamp 约定**：`timestamp` 字段是 **epoch milliseconds**（`Date.now()`
在 JS 里直接就是这个精度）。服务端在归因时会强制 `metric.timestamp >=
exposure.timestamp`，所以 SDK 发送时必须保证 metric event 的时间戳不早于
对应的 flag 曝光时间戳，否则会被 query 丢弃。

```http
POST /api/track HTTP/1.1
Authorization: <envId>
Content-Type:  application/json

[
  {
    "user": { "keyId": "user-123", "properties": { "country": "US" } },
    "variations": [
      { "flagKey": "new-checkout", "variant": "treatment",
        "timestamp": 1776300000000, "experimentId": "exp-1" }
    ],
    "metrics": [
      { "eventName": "checkout-completed", "timestamp": 1776300060000 }
    ]
  }
]
```

响应：

```json
{ "accepted": 2, "dropped": 0 }
```

### `POST /api/track/event`

单条版本，body 是单个 `TrackPayload`（不是数组）。给"我只想发一条"的客户端用。

### `POST /api/query/experiment`

给 stats-service 用，返回某个 (envId, flagKey, metricEvent) 在某个日期范围内
的 per-variant 聚合：

```http
POST /api/query/experiment HTTP/1.1
Content-Type: application/json

{
  "envId":       "rat-env-v1",
  "flagKey":     "run-active-test",
  "metricEvent": "checkout-completed",
  "startDate":   "2026-04-15",
  "endDate":     "2026-04-16"
}
```

响应：

```json
{
  "envId": "rat-env-v1",
  "flagKey": "run-active-test",
  "metricEvent": "checkout-completed",
  "window": { "start": "2026-04-15", "end": "2026-04-16" },
  "variants": [
    {
      "variant": "control",
      "users": 5421, "conversions": 802,
      "sumValue": 0, "sumSquares": 0,
      "conversionRate": 0.1479, "avgValue": 0
    },
    {
      "variant": "treatment",
      "users": 5398, "conversions": 1071,
      "sumValue": 0, "sumSquares": 0,
      "conversionRate": 0.1984, "avgValue": 0
    }
  ]
}
```

JOIN 语义：每个用户**锁定他第一次看到的 variant**（`argMin(variant, timestamp)`），
并记录那次曝光的 timestamp (`exposure_ts`)。然后只统计在窗口期内、且
**timestamp ≥ exposure_ts** 的 metric event，避免"曝光前行为"被错误归因到
variant 上。这与 stats-service 期望的输入完全对齐。

### `GET /health`

返回 `{ "status": "healthy" }`。云端探针用。

---

## 内存队列的语义

- **Bounded** capacity（默认 100k 条）。
- **DropNewest** 模式：队列满时**丢弃新进入的事件**，HTTP handler 不阻塞。
  日志里会打 `Dropped X/Y events (queue full)`。
- 不持久化。如果进程崩溃 / 重启，queue 中未 flush 的事件会丢失。
  对于"分析用聚合数据"的场景这是可以接受的；如果你需要严格 at-least-once，
  把 EventQueue 换成 Event Hub 或本地 WAL。

---

## ClickHouse schema 概览

两张 raw 事件表（`flag_evaluations`、`metric_events`），都是
`MergeTree` + 月分区 + 365 天 TTL（你可以在 `sql/schema.sql` 里改）。

`user_properties` 字段保留为 `String DEFAULT '{}'`，给将来做用户属性切片留位置——
SDK 端塞什么进去（device、country、cohort 等），track-service 都会原样存。
现在 `/api/query/experiment` 还没用这个字段，但 schema 已经准备好了。

`sql/schema.sql` 文件末尾还有两段被注释掉的 `MATERIALIZED VIEW`，
当 raw query 性能跟不上时再启用。
