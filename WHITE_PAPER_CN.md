# FeatBit Release Decision Plugin

## 一页版说明

FeatBit Release Decision Plugin 的目标，是把 FeatBit 现有的 feature flag infrastructure 变成 agent-assisted release decisions 的执行骨架。

coding agents 正在成为新的工程入口，但它们还缺少一层可信能力，去连接 rollout control、system signals，以及每次决策时由人补充的 human context，并形成清晰的发布推荐。FeatBit 可以提供这层能力，而不需要再做一个 standalone agent，也不需要变成一个大而全的 experimentation platform。

这里统一使用三组词：

- `decision inputs`：brief、pull request、ticket，以及其他进入决策流程的输入
- `system signals`：metrics、measurement data、alerts、logs 等系统可观测信号
- `human context`：市场变化、公司决策、战略优先级等人工补充的真实世界上下文

## 核心目标

这个产品要让现有 coding agent 能把 decision inputs 转成结构化计划，通过 FeatBit 执行 rollout control，在用户自己的环境中结合 system signals 和 human context 完成判断，并返回一个人可以审阅的确定性 recommendation，包括实验放量、是否安全发布以及是否需要快速回滚。

## 问题是什么

今天团队已经有 coding agents、feature flags，以及大量 system signals，但还没有一个可信的 operational layer，把这些东西连同每次决策中的 human context 一起连接成一个可用的 release decision loop。没有这层，实验放量、安全发布和故障回滚仍然是手工的、碎片化的，也很难审计。

## 为什么是现在

因为三件事同时发生了：

- agents 正在成为新的交互入口
- release control 已经可以通过 API 和工具安全编排
- 一旦 AI workflow 同时触达代码、flags 和数据，trust boundary 就会变得极其重要

## 市场空白

coding agents 会编排，experiment platforms 会分析，但两者都不是为 operational release decisioning 设计的，更没有严格的 private-data boundary，也不会天然把 decision inputs、system signals 和 human context 一起纳入发布决策。

这就留下了一个空白：

> code generation 和 production rollout 之间的 operational decision layer

## FeatBit 在做什么

FeatBit 正在围绕现有 coding agents 构建一个窄但关键的 release-decision layer：

- 通过 feature flags 和 rollout operations 提供 control-plane integration
- 提供围绕 system signals 和 human context 的 decision tooling
- 提供 deterministic recommendation logic
- 提供对私有数据更友好的 trust boundary
- 输出 agent 和 human 都能审阅的 machine-readable artifacts

这里的战略姿态是增量的：feature flag infrastructure 仍然是可收费的 control plane，而 decision layer 会让这层基础设施更有价值、更难替换。

## 第一楔子

第一个 wedge 是一个简单闭环：coding agent 把 decision inputs 转成 plan，FeatBit 负责 rollout control，本地 runtime 读取 system signals 并结合 human context，系统输出确定性的 recommendation。

这个 wedge 足够小，能安全落地；也足够强，能证明 FeatBit 可以从 feature flag infrastructure 向 release decision infrastructure 扩张。

## 为什么这有防线

这个位置有防线，因为 FeatBit 已经拥有 rollout control，可以把 measurement 留在客户环境中，还可以通过固定 metric templates 和结构化 artifacts 保证行为的确定性与可审计性。

## 它和传统实验平台有什么不同

FeatBit 不是要变成一个以 UI 和分析面为中心的 experimentation platform。

像 GrowthBook 这类产品的重心是平台化实验分析；FeatBit Release Decision Plugin 的重心则是：

- 入口是 coding agent
- 输出是 operational rollout decision，包括继续放量、安全发布或快速回滚
- 数据边界更严格，原始 decision data 留在客户环境中

这就是两者的根本差异。

## 为什么这件事重要

这不是“跳出 feature flags”，而是让 feature flag infrastructure 通过 decision layer 和 trust layer，变得更深地嵌入生产交付流程。

## 核心边界

plugin 可以使用 flag 操作所需的最小 FeatBit control-plane 数据，但 raw decision data、warehouse access 和非必要客户数据都应该留在客户环境中；与此同时，human context 也应该被作为受控输入显式纳入判断。

这个边界本身就是产品价值，而不只是实现细节。

## Go-To-Market

最合理的进入路径，是从已经在用 FeatBit feature flags 的团队切入，解决一个真实的 release-decision workflow，用 trust、speed 和 auditability 做 adoption wedge。

## 战略判断

核心判断是：coding agents 会成为更多工程工作的入口，但企业不会允许它们在没有 trusted control points 的情况下自由穿透代码、数据和生产系统。

FeatBit 有机会成为这样的 trusted control point 之一。