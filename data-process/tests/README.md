# data-process/tests

两类测试：端到端 Integration 测试 + Rollup 服务 Benchmark。

```
tests/
├── integration/   # 端到端：写数据 → flush → rollup → 验证结果
└── benchmark/     # 性能：直接写 delta 到 R2 → rollup-service --run-once → 计时
```

## 前置条件

1. **cf-worker 运行中**（integration 测试需要）
   ```bash
   cd cf-worker && npx wrangler dev --remote
   ```
2. **rollup-service 已编译**
   ```bash
   cd rollup-service && dotnet build
   ```
3. **环境变量**
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   ```

## Integration 测试

```bash
cd tests/integration
npm install
WORKER_URL=http://localhost:8787 npx tsx run.ts
```

**测试流程：**
1. 生成 1000 个确定性用户（`seed.ts`），按 `computeHashBucket` 分配变体，预算期望转化率
2. 以 500/批 POST 到 `cf-worker /api/track`
3. 调用 `/dev/flush` 强制 DO 写 delta 到 R2（跳过 10 分钟等待）
4. 调用 `rollup-service --run-once` 合并 delta
5. 查询 `/api/query/experiment`，断言用户数 / 转化数在 ±2% 容差内

## Rollup Benchmark

```bash
cd tests/benchmark
npm install
npx tsx bench-rollup.ts
```

直接向 R2 写入不同规模的 delta 文件（1k / 10k / 100k 用户），
测量 rollup-service 每次运行的挂钟耗时。
