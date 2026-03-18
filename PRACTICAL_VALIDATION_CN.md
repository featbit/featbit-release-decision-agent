# Practical Validation Notes

这是一个给 founder 自己做判断的版本，不是融资稿。

## 一句话定义

FeatBit 已经通过 feature flags 控制发布，而这个项目是在上面补一层 decision workflow，让 coding agent 能基于私有 measurement data 判断 rollout 应该继续、暂停还是回滚。

## 需要验证的实际闭环

如果这个项目是成立的，下面这个 loop 应该能顺畅跑通：

1. 写一个 release brief。
2. 生成 `plan.json`。
3. 生成 `featbit-actions.json`。
4. 应用 FeatBit rollout changes，或者输出 dry-run actions。
5. 运行 measurement。
6. 生成 `results.json`。
7. 生成 `summary.md`。
8. 决定继续、暂停还是回滚。

如果这个 loop 很 awkward、很绕、或者全是 ceremony，那产品定义还不够好。

## 自检问题

做完一次真实 self-demo 之后，下面这些判断最好都成立：

- 我能用很简单的话解释这个产品。
- 我能不靠脑补就完整 demo 这个闭环。
- agent、FeatBit 和 measurement runtime 的边界是清晰的。
- 这件事确实增强了 FeatBit 的 feature flag infrastructure 价值。
- 即使它永远不变成一个 giant experimentation platform，我也仍然会想要这个产品。

## 建议的下一步

先做一次很严格的 end-to-end dry run，把所有让你犹豫、困惑、解释不清楚的点记下来。

下一轮迭代的目标不是加更多想法，而是减少歧义。