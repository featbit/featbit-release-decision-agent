# run-active-test-worker

Cron 触发的 Cloudflare Worker，负责给 canary 实验 `run-active-test` 持续喂合成数据——**完全通过 HTTP 打 cf-worker 的 `/api/track`**，所以它同时也是整条管道（包括 cf-worker 的公网入口）的端到端健康探针。

## 为什么不塞进 `data-process/cf-worker/`

故意分开部署：

- run-active-test 的目的就是验证 **cf-worker 的 HTTP 入口能用**。如果 generator 和 /api/track 在同一个 Worker 里，内部函数直接调用会绕过 HTTP 边界，就没法证明 /api/track 真的活着了。
- 两边独立部署，互不影响——如果 cf-worker 挂了，这个 worker 会打出 fetch 错误，你在 Cloudflare dashboard 的 scheduled handler logs 里直接看到。

## 它做什么

```
cron "* * * * *"  ── 每分钟触发
      │
scheduled(event, env, ctx)
      │
      ctx.waitUntil(async () => {
        for (let i = 0; i < BURSTS_PER_INVOCATION; i++) {
          const n = randInt(0, MAX_EVENTS_PER_BURST)
          POST https://data-process.featbit.ai/api/track   ← 真实 HTTP
              Authorization: rat-env-v1
              body: [n 个 TrackPayload]
          if (i < last) await sleep(BURST_INTERVAL_MS)
        }
      })
```

默认：
- 每分钟触发 1 次
- 每次触发发 12 个 burst
- 每个 burst 之间 sleep 5 秒
- 每个 burst 0–10 个事件
- 合计每分钟最多 ~120 个事件，平均 ~60

## 发的数据长什么样

每个 `TrackPayload`：
- 一次 flag evaluation：`run-active-test` flag，control / treatment 各 50%
- 也许一条 primary 指标（`checkout-completed`）——control 15%、treatment 20% 转化率
- 也许一条 guardrail 指标（`page-load-error` / `rage-click` / `session-bounce`，各 5% 概率之一）

常量（envId、flagKey、变体、转化率）在 `src/config.ts`，和 `data-process/run-active-test/src/config.ts` 保持一致，这样数据回流到 DB 里依然指向同一个 canary 实验。

## 启动

### 本地测试 cron
```bash
cd data-process/run-active-test-worker
npm install
npm run dev           # wrangler dev --test-scheduled
```

在另一个终端手动触发一次 scheduled handler：
```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

### 部署
```bash
npm run deploy
```

部署后，Cloudflare dashboard → Workers & Pages → featbit-run-active-test → Cron Triggers 里能看到执行历史；Logs 里能看到每次 invocation 的 `[rat-worker] cron=... sent=... fails=...` 汇总。

## 配置（wrangler.jsonc `vars`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `WORKER_URL` | `https://data-process.featbit.ai` | cf-worker 的公网地址 |
| `ENV_ID` | `rat-env-v1` | 放进 `Authorization` header，cf-worker 以此作为 envId |
| `BURSTS_PER_INVOCATION` | `12` | 每次 cron 触发发多少个 burst |
| `BURST_INTERVAL_MS` | `5000` | burst 之间的间隔 |
| `MAX_EVENTS_PER_BURST` | `10` | 每个 burst 最多多少事件（实际 = `[0, MAX]` 的随机数）|

只改 cron 频率的话，改 `wrangler.jsonc` 里的 `triggers.crons` 数组——注意 Cloudflare 最小粒度是 **1 分钟**。

## 与 `data-process/run-active-test/` 的关系

| 项目 | 角色 | 运行方式 |
|---|---|---|
| `run-active-test/` | 一次性 DB 初始化 + Node.js 常驻 generator（旧版）| `npm run setup` 创建实验行；`npm start` 本地长跑 generator |
| `run-active-test-worker/` | 常驻 generator（新版，serverless）| Cloudflare cron，零运维 |

**DB 初始化（`setup-db.ts`）仍然只在 `run-active-test/` 里**——它是一次性脚本，不适合放进 Worker。
Canary 实验记录创建好之后，`run-active-test-worker` 负责持续喂数据。
