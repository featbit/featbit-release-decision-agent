# FeatBit Release Decision Agent

产品实验的下一个范式 —— AI agent 自主跑完从**意图到决策**的完整循环，实验速度对齐产品速度。

---

## 这个项目解决什么问题

硅谷用二十年把产品实验做成了百亿美元的工具市场——Optimizely、Amplitude、LaunchDarkly、Statsig、PostHog——前提是每一步都要高级 PM 和数据科学家来操作。AI 把编码速度提高了 10 倍，产品迭代加速了，但实验没有跟上——大多数团队还是没有假设就上线，度量五个指标挑一个好看的，然后凭感觉开始下一轮。**这让大部分"加速"变成了假增长。**

这套 agent skill set 就是为了填补这个缺口。它在用户所处的任意阶段激活一组**控制视角**——不是固定的流程，而是随时可触发的决策原则——在思路清晰之前，不会跳到具体工具。人类随时可介入，也可以只做最终判断。

Agent 会在会话中维护一个实时决策状态文件（`.featbit-release-decision/intent.md`），确保每个环节的上下文不丢失。

---

## 决策循环

每一个可度量的产品或 AI 变更，都经历同一个循环：

```
意图 → 假设 → 实现 → 暴露 → 度量 → 解读 → 决策 → 学习 → 下一个意图
```

循环本身是框架，工具只是循环内部的实现适配器。

---

## 架构

`featbit-release-decision` 是**枢纽 skill** —— 负责判断当前应激活哪个控制视角、调用哪个卫星 skill。所有其他 skill 都由它触发。

```
                    ┌─────────────────────────────┐
                    │   release-decision.prompt.md │  ← 入口（VS Code / Copilot）
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │    featbit-release-decision  │  ← 枢纽：控制框架 CF-01…CF-08
                    └──┬──────┬──────┬──────┬─────┘
                       │      │      │      │
          ┌────────────┘      │      │      └────────────────┐
          │                   │      │                        │
    ┌─────▼──────┐  ┌─────────▼──┐  ┌▼──────────────┐  ┌────▼──────────┐
    │  intent-   │  │ hypothesis │  │  reversible-  │  │ measurement-  │
    │  shaping   │  │  -design   │  │   exposure-   │  │   design      │
    │  (CF-01)   │  │  (CF-02)   │  │   control     │  │   (CF-05)     │
    └────────────┘  └────────────┘  │ (CF-03/CF-04) │  └───────┬───────┘
                                    └───────────────┘          │
                                                        ┌───────▼───────┐
                                                        │  experiment-  │
                                                        │   workspace   │
                                                        └───────┬───────┘
                                                                │
                                                    ┌───────────▼──────────┐
                                                    │  evidence-analysis   │
                                                    │    (CF-06/CF-07)     │
                                                    └───────────┬──────────┘
                                                                │
                                                    ┌───────────▼──────────┐
                                                    │  learning-capture    │
                                                    │      (CF-08)         │
                                                    └──────────────────────┘
```

### Skill 速览

| Skill | CF | 激活时机 |
|---|---|---|
| `intent-shaping` | CF-01 | 目标模糊，或用户直接跳到战术 |
| `hypothesis-design` | CF-02 | 目标存在，但没有可证伪的因果假设 |
| `reversible-exposure-control` | CF-03 / CF-04 | 准备实现变更，需要 feature flag 和灰度策略 |
| `measurement-design` | CF-05 | 需要定义主指标、护栏指标和事件 schema |
| `experiment-workspace` | CF-05（之后） | 埋点确认完成，准备收集数据并计算 |
| `evidence-analysis` | CF-06 / CF-07 | 数据已收集，需要决策：继续 / 暂停 / 回滚 / 结论不足 |
| `learning-capture` | CF-08 | 一轮实验结束，捕获可复用的学习结论 |

---

## 快速开始

### 前置条件

- AI coding agent：[GitHub Copilot](https://github.com/features/copilot)（agent 模式）、[Claude Code](https://claude.ai/code) 或 [Codex](https://openai.com/codex)
- Node.js 24+ 和/或 Python 3 运行时；.NET 推荐但非必需
- FeatBit 账号（[可选](https://github.com/featbit/featbit)） / [FeatBit Skills](https://github.com/featbit/featbit-skills)（可选） / `featbit` CLI（可选）—— 也可替换为自有 feature flag 系统和数据库 / 数据仓库

### 安装

```bash
# 将此 skill set 安装到你的 agent skills 目录
npx skills add featbit/featbit-release-decision-agent
```

或直接 clone 到本地 skills 目录，将 agent 指向 `instructions/` 文件夹。

### 激活

将 `instructions/release-decision.prompt.md` 作为系统提示词或活动指令文件加载到你的 coding agent。

**Claude Code**
```bash
cc --system instructions/release-decision.prompt.md
```

**GitHub Copilot（VS Code）**  
打开 agent 模式，选择 **FeatBit Release Decision** 自定义模式，或直接将 prompt 文件附加到对话中。

**Codex CLI**
```bash
codex --instructions instructions/release-decision.prompt.md
```

然后描述你的目标 —— agent 会判断你当前所处的阶段并激活正确的控制视角：

```
我们希望更多用户完成新手引导流程
```

---

## 典型会话流程

**第一步：描述目标或问题**

> "我们想提升新 AI 助手功能的使用率。"

Agent 通过 `intent-shaping` 激活 **CF-01** —— 将你的目标与可能混入的解决方案分离，并询问：如果这个目标达成了，你期望看到什么发生变化？

**第二步：将目标转化为假设**

> "我们认为，在操作上下文中增加一个提示气泡，能让新用户的功能激活率提升 15%，因为他们目前根本不知道这个功能的存在。"

Agent 通过 `hypothesis-design` 激活 **CF-02** —— 验证五个要素（变更内容、指标、方向、受众、因果原因）是否完整，并将假设写入 `.featbit-release-decision/intent.md`。

**第三步：将变更放在 feature flag 后面**

Agent 通过 `reversible-exposure-control` 激活 **CF-03 / CF-04** —— 创建 flag，设置保守的初始灰度比例（5–10%），定义受保护受众，以及扩量和回滚的触发条件。

**第四步：定义埋点**

Agent 通过 `measurement-design` 激活 **CF-05** —— 一个主指标、两到三个护栏指标，以及度量它们所需的事件 schema。如需建立数据收集流程，会移交给 `experiment-workspace`。

**第五步：数据积累后，准备决策**

Agent 通过 `evidence-analysis` 激活 **CF-06 / CF-07** —— 在解读结果之前，先确认数据的同步性、充分性和清洁度，然后给出决策分类：**继续（CONTINUE）**、**暂停（PAUSE）**、**回滚候选（ROLLBACK CANDIDATE）** 或 **结论不足（INCONCLUSIVE）**。结果写入 `.featbit-release-decision/decision.md`。

**第六步：关闭这一轮循环**

Agent 通过 `learning-capture` 激活 **CF-08** —— 生成结构化学习记录（发生了什么变更、结果如何、大概为什么、下一步应测试什么），然后重置意图状态，进入下一轮迭代。

---

## 项目结构

```
instructions/
  release-decision.prompt.md       ← agent 入口
skills/
  featbit-release-decision/        ← 枢纽控制框架（CF-01…CF-08）
    SKILL.md
    references/
      skill-routing-guide.md       ← 各 CF 到卫星 skill 的路由映射
  intent-shaping/                  ← CF-01：提炼可度量的业务目标
  hypothesis-design/               ← CF-02：构建可证伪的假设
  reversible-exposure-control/     ← CF-03/CF-04：feature flag 与灰度发布
  measurement-design/              ← CF-05：指标、护栏指标、事件 schema
  experiment-workspace/            ← CF-05+：本地实验文件夹 + 分析脚本
  evidence-analysis/               ← CF-06/CF-07：证据充分性检查 + 决策定性
  learning-capture/                ← CF-08：结构化学习，驱动下一轮迭代
```

会话期间，agent 还会在你的项目中写入：

```
.featbit-release-decision/
  intent.md          ← 实时决策状态（目标、假设、阶段、指标……）
  decision.md        ← evidence-analysis 完成后的决策输出
  experiments/
    <slug>/
      definition.md  ← 实验规格
      input.json     ← 收集的数据
      analysis.md    ← 贝叶斯分析输出
```

---

## 核心原则

- **没有明确意图，不开始实现。** 在目标明确之前，agent 不会协助你动手。
- **没有定义假设，不开始度量。** 你计划度量什么，必须来自你声称会发生什么。
- **没有证据框架，不做决策。** 着急不是数据质量的替代品。
- **没有书面学习，不关闭循环。** 每一轮 —— 无论结果好坏还是结论不足 —— 都必须产出一条可复用的洞察。

---

## 参与讨论

这个项目还处于早期阶段，我们有真实客户在使用，也在持续探索 AI agent 时代数据实验的新形态。

欢迎提 Issue、开 Discussion，或直接联系我们交流想法。

---

## License

MIT
