# rollup-service

.NET 10 后台服务，每10分钟扫描 R2 的 delta 文件并合并进 rollup JSON。

## HTTP 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，返回 `{"status":"healthy"}` |

端口通过 `ASPNETCORE_URLS` 或 `--urls` 参数控制，默认 `http://localhost:5000`。

## 运行

```bash
# 通过环境变量传入凭证（推荐）
$env:R2_ACCOUNT_ID="..."
$env:R2_ACCESS_KEY_ID="..."
$env:R2_SECRET_ACCESS_KEY="..."

dotnet run
```

或创建 `appsettings.Development.json`（已 gitignore）：

```json
{
  "R2": {
    "AccountId":   "your-account-id",
    "AccessKeyId": "your-access-key",
    "SecretKey":   "your-secret-key"
  }
}
```

## 工作流程

```
每 10 分钟：
  1. 查询 PostgreSQL：获取所有 status='running' 的实验的 (envId, flagKey, metricEvent)
     → 构建允许集合，用于过滤 delta 文件（DB 不可用时 fail-open：处理所有 delta）
  2. LIST R2 "deltas/" 前缀
  3. 过滤：只保留属于 running 实验的 delta 文件
  4. 并发处理每个 delta 文件（最多4个并行）
     a. GET delta JSON
     b. GET 对应 rollup JSON（不存在则新建）
     c. 内存 merge
     d. PUT 更新后的 rollup
     e. DELETE delta 文件
```

## 配置项

| 配置 | 环境变量 / appsettings | 默认值 |
|---|---|---|
| R2 AccountId | `R2_ACCOUNT_ID` | — |
| R2 AccessKeyId | `R2_ACCESS_KEY_ID` | — |
| R2 SecretKey | `R2_SECRET_ACCESS_KEY` | — |
| R2 BucketName | — | `featbit-tsdb` |
| 轮询间隔（秒） | `Worker:IntervalSeconds` | `600` |
| 最大并发数 | `Worker:MaxConcurrency` | `4` |
| PostgreSQL 连接串 | `DATABASE_URL` 或 `Database:Url` | 空（不过滤）|
