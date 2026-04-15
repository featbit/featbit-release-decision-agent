# run-active-test

一直保证 **有一个 running 实验的数据在流动**，用来确认 `cf-worker → R2 → rollup-service → stats-service` 整条管道都在工作。

这个项目的数据**不是真实业务数据**，它是一个合成的 canary 实验：只要它的分析结果还在更新，说明整套系统都健康。

---

## 做的两件事

1. **确保 DB 里有一个 running 实验**
   每次启动都会 upsert 一条固定 ID 的 `experiment` + `experiment_run` 记录（status = `running`）。已经存在就更新，不会重复创建。

2. **持续生成事件**
   每 `TICK_SECONDS`（默认 5 秒），随机生成 `0 ~ MAX_EVENTS_PER_TICK`（默认 10）个 `TrackPayload`，POST 到 cf-worker 的 `/api/track`。

---

## 这个测试实验是哪个？

固定 ID，永远就这一个，方便你在 DB 里一眼认出来：

| 字段 | 值 |
|---|---|
| `experiment.id` | `a0000000-0000-0000-0000-000000000001` |
| `experiment.name` | `run-active-test` |
| `experiment.featbit_env_id` | `rat-env-v1` |
| `experiment.flag_key` | `run-active-test` |
| `experiment_run.id` | `b0000000-0000-0000-0000-000000000001` |
| `experiment_run.slug` | `run-active-test-v1` |
| `experiment_run.status` | `running`（每次启动强制置回）|
| `experiment_run.method` | `bayesian_ab` |
| `control_variant` | `control` |
| `treatment_variant` | `treatment` |
| `primary_metric_event` | `checkout-completed` |
| `guardrail_events` | `page-load-error, rage-click, session-bounce` |

模拟的业务场景（只为让数据看起来像真的）：
结账页 "限时优惠" banner，control = 无 banner，treatment = 有 banner。
基础转化率 15%，treatment 提到 20%。每条事件有 5% 概率触发一个 guardrail。

---

## 启动

```bash
cd data-process/run-active-test

# 1. 装依赖
npm install

# 2. 配置环境变量（复制并填写）
cp .env.example .env
# 用系统的 dotenv loader 之类把 .env 加载到 shell，或者直接 export
export DATABASE_URL="postgresql://..."
export WORKER_URL="http://localhost:8787"   # 或部署后的 worker 域名

# 3. （可选）只跑一次 DB upsert
npm run setup

# 4. 启动：先 upsert DB，再进入无限生成循环
npm start
```

---

## 日志

故意很安静。只会打印：

- 启动时：setup-db 的一行结果 + generator 启动参数
- 每 60 秒：一行 heartbeat（`ticks=... totalEvents=...`）
- 出错时：一行错误

其它都不打。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL 连接串，同 `agent/web/.env` |
| `WORKER_URL` | `http://localhost:8787` | cf-worker 的 base URL |
| `TICK_SECONDS` | `5` | 每轮间隔秒数 |
| `MAX_EVENTS_PER_TICK` | `10` | 每轮最多生成多少个事件（每轮都是 `[0, MAX]` 的随机数）|

---

## 怎么确认管道在工作？

1. **启动后 5-10 分钟**，去 R2 看：
   - `deltas/flag-evals/rat-env-v1/run-active-test/<date>/*.json` 应该有新文件（cf-worker → DO 已经 flush）
   - 之后 rollup-service 跑一轮，delta 消失
   - `rollups/flag-evals/rat-env-v1/run-active-test/<date>.json` 应该有新版本

2. **stats-service 跑一轮后**，查 DB：
   ```sql
   SELECT id, slug, status, analysis_result, updated_at
   FROM experiment_run
   WHERE id = 'b0000000-0000-0000-0000-000000000001';
   ```
   `analysis_result` 应该是非空 JSON，`updated_at` 应该是最近的时间。

3. 任一环节出问题（delta 没生成 / rollup 没更新 / analysis_result 不动），说明那一层挂了。
