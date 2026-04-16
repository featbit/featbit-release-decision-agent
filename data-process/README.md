# FeatBit Data Process

A/B 实验数据处理管道。整个目录围绕 **ClickHouse** 作为事件存储重构过一次，
不再有 R2 / Cloudflare Durable Objects / rollup 合并服务那一套。

```
data-process/
├── track-service/            # .NET 10 — 事件入口 + 批量写 ClickHouse + 查询接口
├── stats-service/            # Python FastAPI — 读 ClickHouse、跑 Bayesian / Bandit、写分析结果入 PG
├── run-active-test-worker/   # Cloudflare Worker — cron 每分钟触发，HTTP 打 track-service 持续喂 canary 数据
├── docker-compose.yml        # 本地开发：ClickHouse + track-service + stats-service
└── README.md
```

> `stats-service` 当前还在从旧 R2 读取数据，**需要改写成从 ClickHouse 读**——这是下一步要做的事。

---

## 系统健康信号：run-active-test

`run-active-test-worker` 会**持续生成**一个固定实验的合成数据打到 track-service，
只要它的 ClickHouse 行数还在涨、分析结果还在更新，说明整条管道都活着。

| 字段 | 值 |
|---|---|
| experiment name | `run-active-test` |
| experiment id | `a0000000-0000-0000-0000-000000000001` |
| experiment_run id | `b0000000-0000-0000-0000-000000000001` |
| featbit_env_id | `rat-env-v1` |
| flag_key | `run-active-test` |
| primary_metric_event | `checkout-completed` |
| guardrail_events | `page-load-error, rage-click, session-bounce` |

> 在 PG 或 ClickHouse 里看到这几个固定值，就是 canary 数据，**不是真实业务数据**。

---

## 数据流（新架构）

```
SDK / client
  │  POST /api/track (批量) 或 /api/track/event (单条)
  ▼
track-service (.NET 10, ASP.NET Core)
  │
  │  Channel<EventRecord>  ← 进程内 "in-memory Kafka"，bounded 100k
  │  └── BatchIngestWorker ← 5 秒 / 1000 条触发 flush
  ▼
ClickHouse (featbit.flag_evaluations / featbit.metric_events)
  │
  │  stats-service (每 10 分钟)
  │    └── 查 ClickHouse 拿 per-variant 聚合 → Bayesian / Bandit
  ▼
PostgreSQL (experiment_run.analysis_result)

查询路径:
  stats-service / 前端
    │  POST /api/query/experiment
    ▼
  track-service → ClickHouse (一条 SQL: JOIN flag_evaluations + metric_events by user_key)
```

---

## 本地快速启动

```bash
# 1. 启动 ClickHouse + track-service + stats-service
cd data-process
docker compose up -d clickhouse track-service

# 或单独跑 track-service（dev 模式）
cd data-process/track-service
export CLICKHOUSE_CONNECTION_STRING="Host=localhost;Port=8123;Username=default;Password=clickhouse;Protocol=http;Database=featbit"
dotnet run

# 2. 本地喂 canary 数据
cd data-process/run-active-test-worker
npm install
# .dev.vars 已把 WORKER_URL 指向 http://localhost:5050
npx wrangler dev --test-scheduled --port 8788
# 手动触发一次 scheduled handler（等不及 cron 每分钟一次）：
curl "http://localhost:8788/__scheduled?cron=*+*+*+*+*"
```

ClickHouse schema 见 `track-service/sql/schema.sql`。Docker 启动时会自动加载。

---

## 各子项目的 README

- [track-service/README.md](./track-service/README.md) — API、配置、ClickHouse schema 说明
- [stats-service/README.md](./stats-service/README.md) — Bayesian / Bandit 算法集成（注意当前仍指向 R2，待迁移到 ClickHouse）
- [run-active-test-worker/README.md](./run-active-test-worker/README.md) — canary Worker 配置
