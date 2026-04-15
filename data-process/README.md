# FeatBit Data Process

A/B 实验数据处理管道，分五个子项目：

```
data-process/
├── cf-worker/                # Cloudflare Worker — 事件接收 + 实验查询
├── rollup-service/           # .NET 10 — 每10分钟将 delta 合并进 rollup（仅处理 running 实验）
├── stats-service/            # Python FastAPI — 定期读 rollup、运行 Bayesian/Bandit、写分析结果入 DB
├── run-active-test-worker/   # Cloudflare Worker — cron 每分钟触发，HTTP 打 cf-worker 持续喂 canary 数据
└── shared/                   # 数据格式契约 — TypeScript 类型 + R2 路径约定
```

## 系统健康信号：run-active-test

`run-active-test` 项目会**持续生成**一个固定实验的合成数据，只要它还在更新，说明整条管道都活着。

| 字段 | 值 |
|---|---|
| experiment name | `run-active-test` |
| experiment id | `a0000000-0000-0000-0000-000000000001` |
| experiment_run id | `b0000000-0000-0000-0000-000000000001` |
| featbit_env_id | `rat-env-v1` |
| flag_key | `run-active-test` |
| primary_metric_event | `checkout-completed` |
| guardrail_events | `page-load-error, rage-click, session-bounce` |

> 在 DB 里看到这两个固定 UUID，就是 run-active-test 的 canary 数据，**不是真实业务数据**。详见 `run-active-test/README.md`。

## 数据流

```
SDK (batch)
  → POST /api/track  (cf-worker)
  → PartitionWriterDO  缓冲事件，每10分钟写 delta → R2

rollup-service (每10分钟)
  → 查询 PostgreSQL：仅处理 status='running' 的实验对应 delta
  → 读 R2 delta，merge 进 rollup JSON，写回 R2，删除 delta

stats-service (每10分钟)
  → 查询 PostgreSQL：获取所有 running ExperimentRun
  → 读 R2 rollup，聚合 per-variant 统计
  → 运行 Bayesian 或 Bandit 分析
  → 写 analysis_result → PostgreSQL experiment_run

GET /api/query/experiment  (cf-worker)
  → 读 R2 rollup → 内存计算 → 返回实验结果（实时）
```

## R2 路径约定

| 类型 | 路径 |
|---|---|
| FE delta | `deltas/flag-evals/{envId}/{flagKey}/{date}/{ts}.json` |
| ME delta | `deltas/metric-events/{envId}/{eventName}/{date}/{ts}.json` |
| FE rollup | `rollups/flag-evals/{envId}/{flagKey}/{date}.json` |
| ME rollup | `rollups/metric-events/{envId}/{eventName}/{date}.json` |

路径中的 `{envId}` / `{flagKey}` / `{eventName}` 均经过 `sanitize()` 处理（非 word/hyphen 字符替换为 `_`）。

## 快速启动

```bash
# cf-worker (本地)
cd cf-worker && npm install && npx wrangler dev --remote

# rollup-service (本地)
# 可选：设置 DATABASE_URL 以启用 running-experiment 过滤
cd rollup-service && dotnet run

# stats-service (本地)
cd stats-service
cp .env.example .env   # 填写 DATABASE_URL 和 R2 凭证
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# run-active-test (canary 数据生成器)
cd run-active-test
cp .env.example .env   # 填写 DATABASE_URL 和 WORKER_URL
npm install
npm start
```
