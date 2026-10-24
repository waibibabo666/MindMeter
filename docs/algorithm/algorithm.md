# MindMeter 算法设计

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-001 |
| 版本 | v1.0 |
| 状态 | 完成（阈值待 W5 用户测试后校准） |
| 文档负责人 | song |
| 评审人 | waibibabo666、xlr268、1213lz |
| 最后更新 | 2026-10-19 |
| 关联文档 | [功能需求规范](../requirements/functional_spec.md)、[软件设计](../software/software.md) |

## 二、目的与边界

把 4 个游戏的原始行为数据转换成 0–100 的四维参考分，供报告和复测使用。

边界：

- 只做课程演示级计分，**不做临床常模、不做智商换算**；
- 阈值是团队设定的演示参数，不是经过样本验证的常模；
- 同一份作答 + 同一配置必须得到同一结果；
- 缺数据时不硬算，明确显示“数据不足”。

## 三、原始指标

| 游戏 | 原始指标 | 说明 |
| --- | --- | --- |
| 工作记忆 | `maxSpan`、`accuracy` | 最长正确序列长度；正式试次正确率 |
| 抑制控制 | `accuracy`、`commissionErrors`、`meanRt` | 总正确率；No-Go 误点次数；Go 试次平均反应时 |
| 加工速度 | `medianRt`、`omissions` | 正式试次中位反应时（毫秒）；漏答次数 |
| 情景记忆 | `hits`、`falseAlarms` | 12 个旧词中正确认出数；12 个新词中误认数 |

## 四、计分公式

统一使用截断函数：

```text
clamp01(x) = min(1, max(0, x))
```

### 4.1 工作记忆

```text
spanScore = clamp01((maxSpan - 2) / 6)      // 2 → 0 分，8 → 1 分
accScore  = clamp01(accuracy)
score     = round(100 * (0.6 * spanScore + 0.4 * accScore))
```

### 4.2 抑制控制

```text
accScore        = clamp01(accuracy)
commissionScore = clamp01(1 - commissionErrors / 10)
score           = round(100 * (0.7 * accScore + 0.3 * commissionScore))
```

### 4.3 加工速度

```text
rtScore         = clamp01((800 - medianRt) / 550)   // 800ms → 0 分，250ms → 1 分
omissionPenalty = clamp01(omissions / 20)
score           = round(100 * clamp01(rtScore - 0.5 * omissionPenalty))
```

### 4.4 情景记忆

```text
hitRate        = hits / 12
falseAlarmRate = falseAlarms / 12
score          = round(100 * clamp01(hitRate - falseAlarmRate))
```

### 4.5 综合参考分

```text
overall = round((workingMemory + inhibition + speed + memory) / 4)
```

综合分只用于报告首屏的一句话摘要，**不叫智商、不排名、不与常模比较**。

## 五、异常与缺失

- 某个游戏缺失试次超过 20%：该维度不计算分数，报告显示“数据不足”；
- 反应时小于 100ms 视为误触，不计入中位数；
- 所有分数截断到 0–100 的整数；
- 共享同一份 `scoring-config` 版本，报告记录版本号。

## 六、版本与复现

| 项目 | 规则 |
| --- | --- |
| 配置版本 | `scoring-v1`，写在 `code/core_engine/src/config.js` |
| 变更 | 每次调整阈值或公式升一个小版本，并在本文档记录 |
| 复现 | 输入、配置、版本相同，输出必须相同 |
| 测试 | 每个公式至少有正常、边界、缺失三类单元测试 |

## 七、局限

- 没有中文常模，分数只代表本次任务表现；
- 练习效应、设备差异、睡眠和情绪都会影响结果；
- 复测变化不等于训练效果，报告必须提示“相关不等于因果”；
- W5 用户测试后只校准阈值，不改变“非临床”定位。

## 八、W5 校准记录

| 日期 | 版本 | 调整 | 依据 |
| --- | --- | --- | --- |
| 待填 | scoring-v1.1 | 根据 10–15 人测试调整阈值 | 用户测试数据 |
