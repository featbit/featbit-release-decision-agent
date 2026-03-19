# Trusted Connector Model

## 用途

这个文档定义了下一阶段应采用的凭据模型，用来替代正常运行时直接传递原始数据库连接信息的方式。

当前 MVP 允许：

1. `--connection-env` 作为首选运行路径
2. `--connection` 作为仅限开发阶段的 fallback

这对早期开发是可接受的，但不应成为最终运行模型。

## 目标状态

正常 workflow 应通过 `data_source_id` 引用一个受信连接器，而不是通过 CLI surface 传递原始凭据。

## 目标 Artifact 变化

未来 plan 应从这种形式：

```json
{
  "data_source_kind": "postgres",
  "table": "public.decision_events"
}
```

变成这种形式：

```json
{
  "data_source_kind": "postgres",
  "data_source_id": "customer-prod-metrics",
  "table": "public.decision_events"
}
```

## 核心规则

1. `data_source_id` 是不透明标识，不是 secret。
2. agent 可以看到 `data_source_id`。
3. agent 不应看到底层 password、token 或 connection string。
4. 从 `data_source_id` 到真实凭据的解析应发生在受信执行环境中。
5. plans、summaries、prompts 和 dry-run artifacts 都必须保持无 secret。

## 受信解析边界

受信执行侧负责：

1. 加载加密后的 connector metadata
2. 解密或获取凭据
3. 构造最终数据库连接
4. 记录 connector 使用审计
5. 执行环境级访问控制

agent 侧负责：

1. 选择 recipe
2. 生成 `plan.json`
3. 校验 schema 兼容性
4. 使用 `data_source_id` 调用 runtime
5. 解释 `results.json`

## 未来最小 CLI 形态

当前形式：

```powershell
featbit-decision inspect --data-source-kind postgres --connection-env FB_DECISION_PG --out artifacts/catalog.json
```

未来形式：

```powershell
featbit-decision inspect --data-source-kind postgres --data-source-id customer-prod-metrics --out artifacts/catalog.json
```

`run` 也类似：

```powershell
featbit-decision run --plan artifacts/plan.json --catalog artifacts/catalog.json --data-source-id customer-prod-metrics --out artifacts/results.json
```

## Connector Record 字段

一个受信 connector record 应包含类似字段：

1. `data_source_id`
2. `kind`
3. `environment`
4. `display_name`
5. `credential_reference`
6. `allowed_schemas`
7. `allowed_tables`
8. `created_by`
9. `last_rotated_at`

## 安全属性

该模型应保证：

1. prompts 永远不携带 secrets
2. logs 永远不打印原始凭据
3. 凭据轮换不需要重新生成 plan
4. 环境策略可以阻止未授权 connector 使用
5. 审计日志可以回答谁在什么时候使用了哪个 connector

## 迁移路径

### Phase 1

当前 MVP：

- 正常使用 `--connection-env`
- 保留 `--connection` 作为仅限开发的 fallback

### Phase 2

增加 connector resolution 支持：

- 增加 `--data-source-id`
- 在 runtime 中加载受信 connector metadata
- 将 `--connection-env` 保留给本地开发

### Phase 3

生产默认路径：

- 从正常 workflow 中移除原始凭据处理
- 如仍需要，开发 override 也应放在显式 local-only 开关后面

## 非目标

这个文档不定义：

1. 加密 connector records 的具体存储后端
2. 具体使用哪种 KMS 或 secret manager
3. FeatBit 侧 connector 管理 UI 的精确形式
4. 多租户 RBAC policy 细节

## 对实现的直接影响

实现该模型时，以下部分必须一起修改：

1. `plan.json` contract
2. CLI 参数和 help text
3. runtime connection resolution
4. demo scripts 和 examples
5. 所有提到连接处理的 prompt 指令