# Bayesian A/B 测试进阶教程（第二部分）

> 本教程基于以下资料：
> - 书籍：Experimentation for Engineers
> - 我们的实现：
>   - `skills/experiment-workspace/scripts/stats_utils.py` — 共享统计工具库
>   - `skills/experiment-workspace/scripts/analyze-bayesian.py` — Bayesian A/B 分析
>   - `skills/experiment-workspace/scripts/analyze-bandit.py` — Thompson Sampling 权重计算

---

## 目录

1. [Multi-Armed Bandits（多臂老虎机）](#第一章multi-armed-bandits多臂老虎机)
2. Sequential Testing 在贝叶斯框架下（待更新）
3. Family-wise Error 自动校正（待更新）
4. Holdout Groups（待更新）

---

## 第一章：Multi-Armed Bandits（多臂老虎机）

### 1.1 直觉：为什么需要 MAB？

我们当前的 A/B 测试流程是固定 50/50 流量，跑完整个实验周期再分析。但这有一个隐性代价：

> 实验跑了 5 天，P(win) 已经达到 88%，信号很强但还没到 95%。这时每一天你仍然在把 **50% 的流量分配给一个你已经认为更差的版本**。

这个被浪费的收益叫做 **Regret（遗憾值）**：把流量分配给次优 arm 所损失的业务收益。

MAB 的目标：**在实验过程中动态调整流量，让更好的 arm 越来越多地获得流量，同时保留探索能力防止误判。**

---

### 1.2 名字的来源：老虎机类比

想象你走进赌场，面前有 3 台老虎机（slot machine），每台中奖概率不同，但你不知道哪台更好：

```
老虎机 A：真实中奖率 30%（你不知道）
老虎机 B：真实中奖率 15%（你不知道）
老虎机 C：真实中奖率 45%（你不知道）
```

你有 1000 次机会，目标是赚到最多的钱。

- 只拉一台（纯利用）→ 可能一直拉最差的那台
- 均匀拉三台（纯探索）→ 浪费太多次在差的机器上
- **最优策略：边探索边把更多次数分给看起来更好的机器**

这就是 **Explore vs Exploit 的权衡**。名字来源：multi-armed = 多台机器，bandit = 老虎机（单臂强盗）。

**在 A/B 测试里：**

```
每个 arm = 一个 variant（变体），不是一个实验
同一个实验里可以有多个 arm：

arm_A = control（灰色按钮）
arm_B = treatment 1（蓝色按钮）
arm_C = treatment 2（红色按钮）
```

---

### 1.3 Thompson Sampling 核心机制

Thompson Sampling 的核心操作只有一步：

> **从每个 arm 的后验分布中各抽一个样本，谁抽到的值最大，就选谁。**

**具体步骤（以两个 arm 为例）：**

当前数据：
```
arm_A (control):   n=3000, k=63  → 转化率 2.1%
arm_B (treatment): n=3000, k=78  → 转化率 2.6%
```

**Step 1：为每个 arm 建立后验分布（CLT 近似）**
```
arm_A 后验：N(μ=0.021, se²=0.021×0.979/3000)
arm_B 后验：N(μ=0.026, se²=0.026×0.974/3000)
```

**Step 2：从每个后验各随机抽一个值**
```python
sample_A = np.random.normal(0.021, se_A)  # 比如抽到 0.023
sample_B = np.random.normal(0.026, se_B)  # 比如抽到 0.025
```

**Step 3：谁的 sample 更大，这一次选谁**
```
sample_A=0.023 < sample_B=0.025  → 这一次选 arm_B
```

**Step 4：重复 10000 次，统计每个 arm 被选中的比例**
```
arm_A 被选中：1800 次 → 18%
arm_B 被选中：8200 次 → 82%

→ 下一轮流量分配：arm_A 18%，arm_B 82%
```

---

### 1.4 为什么这个方法自动平衡探索与利用？

关键在于后验分布的**宽窄**随样本量变化：

```
样本少时：后验分布很宽（不确定性大）
          → 抽样结果随机性大
          → 各 arm 都有机会被选中
          → 自然保留探索能力

样本多时：后验分布很窄（越来越确定）
          → 更好的 arm 几乎每次抽到更大的值
          → 流量自动集中到最优 arm
          → 自然转向利用
```

**探索与利用的平衡是自动的，不需要手动调参。** 这是 Thompson Sampling 比 Epsilon-Greedy 更优雅的地方。

---

### 1.5 关于停止阈值：为什么是 95%？

95% 是**惯例，不是数学定律**。它来自频率学的 `alpha = 0.05`，整个行业用惯了。

在贝叶斯框架下，阈值是**业务决策**，取决于两种错误的代价：

| 错误类型 | 含义 | 代价 |
|---------|------|------|
| 错误发布（False Positive） | P(win) 高但 treatment 其实更差 | 用户体验受损 |
| 错误不发布（False Negative） | P(win) 低但 treatment 其实更好 | 失去潜在收益 |

**阈值选择原则：**
- 发布难以回滚 → 用更高阈值（99%）
- 有 feature flag 可以随时关掉 → 可以用更低阈值（90%）
- 守护指标（不能变坏）→ 反向检查 `P(harm) < 1%`

---

### 1.6 两个关键工程细节

Thompson Sampling 在实际工程中需要两个保护机制，都有书中的理论依据。

**细节一：Burn-in 期——每个 arm 至少 100 人才启动动态调权**

书中明确指出（Chapter 3）：

> "The bootstrap distribution converges to the normal distribution by the Central Limit Theorem for sample sizes above ~100 per variant."

样本量不足 100 时，后验分布极宽、噪声主导，此时算出的 P(best) 几乎是随机的。用噪声数据调整流量权重，反而会引入错误的早期偏斜，让一个"只是运气差"的 arm 过早失去流量。

**结论：Burn-in 阶段保持均等分配，每个 arm 都达到 100 人后再启动动态调权。**

**细节二：最低流量保底——每个 arm 保留至少 1%**

书中 Chapter 3（探索-利用权衡）明确说：

> "Never allocate zero traffic to any arm. Early data is noisy — an arm that looks bad after 50 samples may be the true winner. Keeping a minimum exploration floor ensures you can always recover from early misreadings."

书中 Chapter 8（Optimism Bias）也呼应：小样本下表现差的 arm，很可能只是运气不好。完全砍掉流量等于永久放弃修正机会。

**结论：无论 P(best) 多低，每个 arm 始终保留 ≥ 1% 的流量。**

**Top-Two 策略：减少"无效探索"**

在此基础上，可以进一步优化：只在 P(best) 最高的两个 arm 之间竞争主要流量，其余 arm 仅保持最低流量。

```
3 个 arm 的例子：
arm_A: P(best) = 70%
arm_B: P(best) = 25%
arm_C: P(best) = 5%

Top-Two 分配：
arm_A: 70/(70+25) = 73.7%
arm_B: 25/(70+25) = 26.3%
arm_C: 1%（最低保底，不完全放弃）
```

好处：把探索集中在"仍有机会的竞争者"之间，减少流量浪费在已经明显落后的 arm 上。

**与我们现有实现的关系：**

| | 我们的 A/B | Thompson Sampling MAB |
|--|-----------|----------------------|
| 流量分配 | 固定 50/50，全程不变 | 每轮按 P(win) 动态调整 |
| 实验期间 | 一直在"浪费"流量给次优 arm | 流量自动向更好的 arm 倾斜 |
| 最终结论 | δ (delta) 的估计更准确 | 积累的 Regret 更少 |
| 适合场景 | 需要知道"提升了多少" | 需要最大化实验期间的总收益 |

我们目前的 `P(win)` 计算（`norm.sf(0, μ_rel, se_rel)`）是 Thompson Sampling 抽样过程的**解析等价**——与其抽 10000 次再统计，不如直接算概率。两者在数学上等价。

MAB 需要的额外能力：把 P(win) **反馈给流量分配系统**，动态调整 variant 的权重。这需要和 FeatBit feature flag 的流量分配打通。

---

## 学习进度

- [x] 第一章：Multi-Armed Bandits（1.1 ~ 1.6）
- [ ] 第二章：Sequential Testing 在贝叶斯框架下
- [ ] 第三章：Family-wise Error 自动校正
- [ ] 第四章：Holdout Groups
