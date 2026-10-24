# 认知维度的依据调研与改动建议

> **历史调研（2026-10-24 前）**：团队最终拍板改为 8 项能力，本文的“四项不换、不增加总时长、不做第五维”不再作为实现依据；当前口径见 [功能需求 v3.0（L2）](../requirements/functional_spec.md)、[算法设计 v4.0](../algorithm/algorithm.md)。保留本文仅用于追溯取舍过程。

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-REQ-005 |
| 版本 | v0.9（调研稿） |
| 状态 | 待组内评审 |
| 文档负责人 | xlr268 |
| 评审人 | waibibabo666、song、1213lz |
| 最后更新 | 2026-10-24 |
| 关联文档 | [功能需求规范](../requirements/functional_spec.md)、[非功能需求规范](../requirements/nonfunctional_spec.md)、[算法设计](../algorithm/algorithm.md) |

## 一、这次调研要回答什么

问题：现有四个维度（工作记忆、抑制控制、加工速度、情景记忆）的依据不够充分。本文件回答三件事：

1. 学术界怎么划分认知维度，我们的四项各自对应哪套模型；
2. 我们现在的任务，测到的是不是那个构念；
3. 在**不增加测评总时长**的前提下，改哪里最划算。

结论先行：**四项不换，两处改名、三处计分、四处试次；不做第五维，不做动态维度。**

## 二、权威模型不止一套，没有"四维"这种分法

| 模型 | 代表文献 | 分法 | 与我们的关系 |
| --- | --- | --- | --- |
| CHC 心理测量模型 | McGrew (2009) | Gf 推理、Gc 言语、Gwm 工作记忆、Gs 加工速度、Glr 长时存储与提取等 10 项广义能力 | 我们占了 Gwm、Gs、Glr 的一部分 |
| 执行功能三成分 | Miyake et al. (2000)；Diamond (2013) | 抑制、工作记忆、认知灵活性 | 占两项，缺灵活性 |
| 记忆系统 | Tulving (1972, 2002) | 工作记忆、情景、语义、程序 | 只取情景记忆的"再认"子集 |
| 注意网络 | Posner & Petersen (1990) | 警觉、定向、执行控制 | 未覆盖 |
| 临床/商用工具 | WAIS-IV | 言语理解、知觉推理、工作记忆、加工速度四指数 | 我们的划分与之最接近，但少两个指数 |

**判断**：不存在学界公认的"四维心智"。我们的四项是产品口径，横跨三套模型。这个事实要写进报告，而不是遮掩——遮掩会在答辩时被追问。

## 三、逐项对照：名字和任务对得上吗

| 维度 | 目标构念 | 经典范式 | 我们现在的任务 | 判断 |
| --- | --- | --- | --- | --- |
| 工作记忆 | Gwm：短时存储 + 操作 | 数字/空间广度、n-back | 九宫格闪光序列复现 | **部分符合**：≈Corsi 空间广度，测存储与复现，不测"更新"成分 |
| 抑制控制 | 反应抑制（prepotent response inhibition） | Go/No-Go、Stroop、停止信号 | Go/No-Go，40 试次，25% No-Go | **符合**，但试次偏少（常规 100+），且无法计算 SSRT |
| 加工速度 | Gs：含决策与视觉搜索 | 符号搜索、编码、简单/选择 RT | 简单反应时，20 试次 | **名不副实**：测的是精神运动速度，不是 Gs |
| 情景记忆 | 情景记忆：带情境绑定的延迟提取 | 词表延迟回忆、来源记忆 | 12 词看 20 秒后立即再认 | **名不副实**：本质是短时言语再认，没有延迟与情境绑定 |

另外两个结构性缺口（本期不补，但要写明）：

- **认知灵活性**（Diamond 三成分之一）没有覆盖；
- **推理 Gf** 没有覆盖，而它是"认知能力"叙事里权重最高的一项。

## 四、信度现实：组长的担心是有依据的

- **Hedge, Powell & Sumner (2018)**：很多经典认知任务在组水平上效应非常稳定，但个体差异的重测信度很低，作者称之为"信度悖论"。
- **Enkavi et al. (2019)**：对常用行为任务做大规模重测，多数测量的重测信度低于 0.7 这一"个体差异可用"的常用门槛。
- **Wöstmann et al. (2013)**：Go/No-Go、Stroop 等反应抑制任务的信度多在中等偏低区间。

**这不是我们实现得不好，是这类任务的共性。** 应对方式只有三条：增加试次、聚合指标、公开边界。靠"再找一个更权威的维度"解决不了。

## 五、可参照的短 battery（借结构，不借常模）

| 工具 | 结构 | 对我们的意义 |
| --- | --- | --- |
| Cogstate Brief Battery | 4 个任务、约 15 分钟，覆盖精神运动速度、注意、工作记忆、学习/再认记忆 | **结构几乎同构**，是我们最该引用的先例 |
| Creyos（原 Cambridge Brain Sciences） | 12 个任务、约 30 分钟，科研使用 | 说明多维度短 battery 的可行形态 |
| NIH Toolbox Cognition Battery | 7 个任务、约 30 分钟，每项 2–4 分钟 | 说明"短任务 + 效度比对"的标准做法 |

**引用方式**：写明"任务结构参照上述短 battery 的组织方式，但不采用其常模与切点"。不能写"经过信效度验证"——我们没有常模样本。

## 六、定论：改动方案

### 6.1 总原则

> 维度集合固定，试次难度与报告叙事可以动态；AI 只参与表达，不参与测量。

### 6.2 逐项改动

| 维度 | 改成的名字 | 任务调整 | 计分调整 |
| --- | --- | --- | --- |
| 工作记忆 | **视空间工作记忆**（Corsi 序列广度） | 不动：8 次正式、长度 3–7 | 不动：0.6 × 广度 + 0.4 × 正确率 |
| 抑制控制 | 名字不变 | **40 → 60 试次**，No-Go 仍占 25% | Go 正确率 ×0.4 + No-Go 正确拒绝率 ×0.6；commission rate 单独展示 |
| 加工速度 | **反应速度（简单反应时）** | **20 → 30 试次** | 中位数 + 四分位距（IQR）；漏答罚分分母改为 30 |
| 情景记忆 | **词语再认** | **24 → 32 项目**（16 旧 + 16 新） | 改用 **d′**，不再用命中率减虚报率 |

### 6.3 综合分的处理

保留数字，但改名与加注：

- 名称由"综合参考分"改为**"四项均分"**；
- 副标题固定写明"仅供参考，不代表总体认知能力，也不与人群比较"。

叫"综合分"会天然被读成智商，叫"四项均分"就只是一个统计描述。

### 6.4 为什么不是"加维度"或"换维度"

| 方案 | 为什么不做 |
| --- | --- |
| 加第五维 | 15 分钟装不下；每加一项，四个原有维度的试次都要被压缩，信度更低 |
| 换成推理 Gf | 需要新素材与独立效度论证，6 周内做不完；且与"15 分钟体验"冲突 |
| 动态维度集合（不同人测不同项） | 破坏跨次可比，复测对比直接失效；表面上更聪明，实际拿信度换花样 |
| 让模型生成维度 | 不可复现、无法验证、无法在答辩时解释"这个维度怎么来的" |

## 七、计分公式的具体改动

### 7.1 词语再认：改用 d′

```text
H = (命中数 + 0.5) / (16 + 1)        // 0.5 校正，避免命中率为 0 或 1 时 d′ 发散
F = (虚报数 + 0.5) / (16 + 1)
d′ = z(H) − z(F)                     // z 为标准正态分布分位数
参考分 = clamp(0, 100, round((d′ + 1) / 5 × 100))
```

按 d′ = −1 → 0 分、d′ = 4 → 100 分映射。校准区间在 W5 用户测试后确定。

### 7.2 抑制控制：报比率，不报次数

```text
commissionRate = 误报次数 / No-Go 试次数
score = round(100 × (0.4 × Go 正确率 + 0.6 × (1 − commissionRate)))
```

40 试次时报 3 次误报和 60 试次时报 3 次误报含义完全不同，比率才可比。

### 7.3 反应速度：中位数 + IQR

```text
medianRt = 有效试次的中位数
iqr = P75 − P25
若 iqr > 300ms，报告标注"本次反应波动较大"
```

反应时右偏，均值容易被长尾拖走；中位数更稳，IQR 顺带给出稳定性信息。

### 7.4 版本

以上改动统一升版为 `scoring-v2`，并在 `algorithm.md` 第六节记录变更。

## 八、扩展观察（可选，W4 有余量再做）

从**试次级数据**派生 1–2 个行为指标，单独区块展示，**不进总分、不参与复测对比**。

| 指标 | 计算 | 最少试次 | 说明什么 |
| --- | --- | --- | --- |
| 反应时变异系数 | SD ÷ 均值 | ≥20 | 反应稳定性 |
| 练习效应斜率 | 后 1/3 与前 1/3 的 RT 差 | ≥30 | 上手速度 |
| 再认反应偏向 c | −0.5 × [z(H) + z(F)] | ≥32 | 是否倾向说"见过" |

展示规则（写死，不交给模型判断）：

1. 试次不足门槛则不显示；
2. 最多显示 2 条；
3. 一律用行为描述——"后段变慢"而不是"认知疲劳"，"反应波动偏大"而不是"注意力稳定性差"；
4. 与四个主维度视觉区分，注明"描述性指标，不构成诊断"。

## 九、明确不做

- 第五维、动态维度集合、AI 生成维度；
- 真正的自适应测评（CAT）：没有标定题库与样本量；
- 30 秒延迟再认：时间允许就做，默认砍掉，改名已能解决表述问题；
- 任何形式的常模、脑龄、智商换算。

## 十、成本与取舍

| 改动 | 估时 |
| --- | --- |
| 四个任务参数调整 + 计分改造 | 1.5 人日 |
| 单测补充（d′、commissionRate、IQR） | 1 人日 |
| 报告页文案与标签调整 | 0.5 人日 |
| 扩展观察（可选） | 1 人日 |

合计 3 人日（不含扩展观察）。按"6 周只做减法"的规矩，砍掉分享卡片（F-15）即可腾出。

## 十一、需要同步修改的位置

| 文件 | 改什么 |
| --- | --- |
| `functional_spec.md` 第六节 | 四个游戏的名字与试次（40→60、20→30、24→32） |
| `algorithm.md` 第四节 | d′、commissionRate、中位数 + IQR 的公式 |
| `algorithm.md` 第六节 | 版本号升到 `scoring-v2`，记录变更 |
| 报告页文案 | 四个维度名、"四项均分"、数据不足说明 |
| `user_stories.md` US-04 | "四维分数"改为"四个维度参考分" |

## 十二、对质疑的答复口径

> 维度不换，换的是口径。两项改名字，是因为任务本身测不到那个构念——立即再认不是情景记忆，简单反应时不是加工速度；两项加试次，是因为 40 次和 20 次的信度撑不起个体比较。改完之后，四个维度都能说清"测的是哪个经典范式、指标怎么算、边界在哪"，这比再加两个维度更能回应"依据不足"。

## 十三、参考文献

**维度依据**

- Miyake, A., et al. (2000). The unity and diversity of executive functions. *Cognitive Psychology*, 41(1), 49–100. doi:10.1006/cogp.1999.0734
- Diamond, A. (2013). Executive functions. *Annual Review of Psychology*, 64, 135–168. doi:10.1146/annurev-psych-113011-143750
- McGrew, K. S. (2009). CHC theory and the human cognitive abilities project. *Intelligence*, 37(1), 1–10.
- Conway, A. R. A., et al. (2005). Working memory span tasks: A methodological review and user's guide. *Psychonomic Bulletin & Review*, 12(5), 769–786.
- Kessels, R. P. C., et al. (2000). The Corsi Block-Tapping Task: standardization and normative data. *Applied Neuropsychology*, 7(4), 252–258.
- Salthouse, T. A. (1996). The processing-speed theory of adult age differences in cognition. *Psychological Review*, 103(3), 403–428.

**信度与效度**

- Hedge, C., Powell, G., & Sumner, P. (2018). The reliability paradox: Why robust cognitive tasks do not produce reliable individual differences. *Behavior Research Methods*, 50(3), 1166–1186. doi:10.3758/s13428-017-0935-1
- Enkavi, A. Z., et al. (2019). Large-scale analysis of test–retest reliabilities of self-regulation measures. *PNAS*, 116(12), 5472–5477. doi:10.1073/pnas.1818430116
- Wöstmann, N. M., et al. (2013). Reliability and plasticity of response inhibition and interference control. *Brain and Cognition*, 81(1), 82–94.

**短 battery 先例**

- Maruff, P., et al. (2009). Validity of the CogState brief battery. *Archives of Clinical Neuropsychology*, 24(2), 165–178.
- Weintraub, S., et al. (2013). Cognition assessment using the NIH Toolbox. *Neurology*, 80(11 Suppl 3), S54–S64.

**训练迁移（用于约束产品表述）**

- Owen, A. M., et al. (2010). Putting brain training to the test. *Nature*, 465, 775–778. doi:10.1038/nature09042
- Simons, D. J., et al. (2016). Do "brain-training" programs work? *Psychological Science in the Public Interest*, 17(3), 103–186. doi:10.1177/1529100616661983

**统计方法**

- Stanislaw, H., & Todorov, N. (1999). Calculation of signal detection theory measures. *Behavior Research Methods, Instruments, & Computers*, 31(1), 137–149.

