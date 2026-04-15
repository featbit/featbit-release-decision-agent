# stats-service

Python FastAPI 服务，定期从 R2 读取 rollup 数据、运行 Bayesian / Bandit 统计分析，并将结果写回 PostgreSQL。

## 职责

```
每 10 分钟：
  1. 查询 PostgreSQL：找到所有 status = 'running' 的 ExperimentRun
  2. 从 R2 读取对应的 flag-eval + metric-event rollup 文件（观测窗口内所有日期）
  3. 聚合 per-variant 统计（用户数、转化数）
  4. 运行 Bayesian（默认）或 Thompson Sampling Bandit 分析
  5. 将 analysis_result 写回 experiment_run 表
```

## 算法

| 方法 | 文件 | 说明 |
|---|---|---|
| Bayesian | `bayesian.py` | 分析高斯后验 A/B，输出 chance-to-win、相对变化量、置信区间、风险 |
| Bandit | `bandit.py` | Thompson Sampling + Top-Two 策略，输出推荐流量权重 |
| 共享工具 | `stats_utils.py` | metric_moments、bayesian_result、srm_check 等基础函数 |

> 算法逻辑来自 `skills/experiment-workspace/scripts/`，已提取为纯计算模块（无 CLI / DB 依赖）。

## 快速启动

```bash
cd data-process/stats-service

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（复制并填写）
cp .env.example .env

# 启动服务
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（同 agent/web/.env） | — |
| `R2_ACCOUNT_ID` | Cloudflare 账号 ID | — |
| `R2_ACCESS_KEY_ID` | R2 访问密钥 ID | — |
| `R2_SECRET_ACCESS_KEY` | R2 访问密钥 | — |
| `R2_BUCKET_NAME` | R2 存储桶名称 | `featbit-tsdb` |
| `ANALYSIS_INTERVAL_SECONDS` | 分析周期（秒） | `600` |

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| POST | `/api/analyze/{run_id}` | 立即重新分析指定 ExperimentRun |
| GET | `/api/results/{run_id}` | 查询最新分析结果 |

## 数据流

```
R2 rollups/flag-evals/{envId}/{flagKey}/{date}.json
R2 rollups/metric-events/{envId}/{metric}/{date}.json
        │
        │  aggregate_experiment() — r2.py
        ▼
metrics_data = { "<metric>": { "<variant>": { "n": N, "k": K } } }
        │
        ├── method=bayesian  → bayesian.py → compute_bayesian()
        └── method=bandit    → bandit.py   → compute_bandit_result()
                │
                ▼
        PostgreSQL: experiment_run.analysis_result (JSON)
```

## 输出格式

### Bayesian
```json
{
  "type": "bayesian",
  "run_id": "...",
  "computed_at": "2026-04-15T10:00:00Z",
  "control": "off",
  "treatments": ["on"],
  "srm": { "chi2_p_value": 0.31, "ok": true },
  "primary_metric": {
    "event": "checkout",
    "metric_type": "proportion",
    "rows": [...],
    "verdict": "strong signal → adopt treatment"
  },
  "sample_check": { "minimum_per_variant": 400, "ok": true }
}
```

### Bandit
```json
{
  "type": "bandit",
  "run_id": "...",
  "computed_at": "2026-04-15T10:00:00Z",
  "metric": "checkout",
  "enough_units": true,
  "best_arm_probabilities": { "off": 0.12, "on": 0.88 },
  "bandit_weights": { "off": 0.14, "on": 0.86 }
}
```
