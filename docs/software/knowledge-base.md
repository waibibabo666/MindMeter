# 本地知识库设计（P-06）

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-004 |
| 版本 | v1.1（评审通过，交 L-06 实现） |
| 状态 | 已定稿 |
| 负责人 | 1213lz |
| 支持 | xlr268 |
| 关联 | Issue [#30](https://github.com/waibibabo666/MindMeter/issues/30)、[M1 范围](../mgmt/m1_scope.md)、[Agent 设计](../requirements/xlragentdesign.md)、[算法设计](../algorithm/algorithm.md) |

> 一句话：定下**知识块放什么、每条长什么样、来源怎么记**，让 L-06 能直接照着填 30 条并做检索。

## 二、目的与边界

### 2.1 解决什么问题

Agent 回答"我这个分数低是什么意思"时，不能只靠模型自由发挥，必须：

1. 有本地知识可检索（不联网、不调模型也能给出依据）；
2. 每条知识**能追溯到来源**，评审时点得开；
3. 检索不到时明确说"不知道"，而不是编。

### 2.2 边界

| 做 | 不做 |
| --- | --- |
| 解释维度是什么、测什么 | 诊断、治疗建议、疾病推断 |
| 说明分数怎么来的、怎么读 | 常模、百分位、智商换算、脑龄 |
| 说明局限与免责 | 训练疗效承诺、"练了就能变聪明" |
| 给一般性的作息与练习建议 | 个性化医疗或心理干预方案 |

**知识库是"引用材料"，不是"结论来源"。** 分数永远由 `scoring/` 算，知识块只负责解释。

## 三、分类体系

六类，共 30 条。分类代号写进 chunk 的 `category` 字段，检索时可先按类过滤。

| 代号 | 分类 | 回答什么问题 | 条数 |
| --- | --- | --- | --- |
| `dim` | 维度解释 | 这个维度是什么、测什么、不测什么 | 12 |
| `task` | 任务说明 | 用户刚做的那道题在测什么 | 4 |
| `score` | 分数与报告 | 分数怎么算、为什么没有总分、未测是什么 | 5 |
| `factor` | 影响因素 | 睡眠、设备、练习效应怎么影响结果 | 3 |
| `limit` | 局限与安全 | 非诊断、非常模、不测什么、数据在哪 | 4 |
| `plan` | 改善建议 | 可执行的日常做法、什么时候该找专业人士 | 2 |

> M1 只测 4 个维度（vc / ps / sv / am），所以 `dim` 类只覆盖这 4 项。
> M2 扩到 8 维时，`dim` 类按同样模板再加 12 条，其余分类不变。

## 四、Chunk schema

### 4.1 字段定义

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string | ✅ | `kb-{category}-{两位序号}`，全局唯一 | 例：`kb-dim-vc-01` |
| `category` | enum | ✅ | `dim`/`task`/`score`/`factor`/`limit`/`plan` | 见第三节 |
| `dims` | string[] | ✅ | 可为空数组 | 关联维度：`vc`/`ps`/`sv`/`am` |
| `title` | string | ✅ | ≤ 20 字 | 检索展示用 |
| `text` | string | ✅ | **120–220 字**，中文 | 知识正文，第三人称陈述 |
| `source` | object | ✅ | 见 4.2 | 来源，必须能核验 |
| `version` | string | ✅ | 语义化，如 `1.0` | 本块内容的版本 |
| `risk` | enum | ✅ | `low`/`medium`/`high` | 见第六节 |
| `review` | object | ✅ | 见 4.2 | 审核状态 |
| `tags` | string[] | ✅ | 2–5 个 | 检索辅助词 |
| `param` | string \| null | ✅ | 可空 | 含产品参数时指向 `scoring/config.js` 的键名 |

### 4.2 子结构

```json
{
  "source": {
    "kind": "textbook | paper | org | product",
    "title": "文献或页面标题",
    "author": "作者或机构",
    "year": 2020,
    "locator": "章节或页码，如 第 5 章 第 2 节",
    "url": "https://…（可选，仅 org 类必填）"
  },
  "review": {
    "status": "draft | reviewed | rejected",
    "by": "GitHub 用户名",
    "date": "2026-11-07"
  }
}
```

### 4.3 示例（一条完整 chunk）

```json
{
  "id": "kb-dim-sv-01",
  "category": "dim",
  "dims": ["sv"],
  "title": "空间视觉化测什么",
  "text": "空间视觉化指在头脑中生成、保持并操作视觉图像的能力。本次测评用三乘三图案的旋转判断来观察它：题目给出一张原始图案，要求选出顺时针旋转九十度后的结果。这类任务主要依赖心理旋转，与语言或计算关系不大，因此分数高低更多反映图像操作的速度与准确性，而不是记忆量或词汇量。",
  "source": {
    "kind": "paper",
    "title": "Mental rotation of three-dimensional objects",
    "author": "Shepard, R. N., & Metzler, J.",
    "year": 1971,
    "locator": "Science, 171(3972), 701–703"
  },
  "version": "1.0",
  "risk": "low",
  "review": { "status": "draft", "by": "", "date": "" },
  "tags": ["空间", "心理旋转", "图案"],
  "param": null
}
```

### 4.4 写作约束（会进校验脚本）

1. **禁用词**：诊断、治疗、治愈、确诊、智商、脑龄、百分位、常模、证明、一定、必然、肯定；
2. **不得出现具体分数阈值**。若必须提到锚点（例如"多少个正确匹配对应 100 分"），`param` 必须指向 `scoring/config.js` 的键，`text` 不写数字；
3. **不做人格或疾病推断**（"说明你缺乏空间感"这类表述一律不要）；
4. 中文正文，英文文献须**译述**而非整段引用；
5. 单条不超过 300 tokens（约 220 汉字），保证 top3 拼进 prompt 后不撑爆上下文。

## 五、30 条 chunk 计划

> `来源` 列填的是**候选来源编号**，对应第六节的清单；全部标记为"待核验"。

| # | id | 分类 | 维度 | 标题 | 来源（候选） |
| --- | --- | --- | --- | --- | --- |
| 1 | `kb-dim-vc-01` | dim | vc | 言语理解测什么 | S01 · S10 |
| 2 | `kb-dim-vc-02` | dim | vc | 词汇与句子理解的关系 | S01 |
| 3 | `kb-dim-vc-03` | dim | vc | 言语分数低不代表什么 | S01 · S12 |
| 4 | `kb-dim-ps-01` | dim | ps | 知觉速度测什么 | S09 |
| 5 | `kb-dim-ps-02` | dim | ps | 限时任务的特点 | S09 |
| 6 | `kb-dim-ps-03` | dim | ps | 加工速度与日常表现 | S09 · S11 |
| 7 | `kb-dim-sv-01` | dim | sv | 空间视觉化测什么 | S07 |
| 8 | `kb-dim-sv-02` | dim | sv | 心理旋转是什么 | S07 |
| 9 | `kb-dim-sv-03` | dim | sv | 空间能力能不能练 | S07 · S11 |
| 10 | `kb-dim-am-01` | dim | am | 联想记忆测什么 | S04 · S06 |
| 11 | `kb-dim-am-02` | dim | am | 再认与回忆的区别 | S04 |
| 12 | `kb-dim-am-03` | dim | am | 记忆分数受什么影响 | S04 · S12 |
| 13 | `kb-task-vc-01` | task | vc | 言语题是怎么做的 | 产品事实 |
| 14 | `kb-task-ps-01` | task | ps | 符号匹配是怎么做的 | 产品事实 |
| 15 | `kb-task-sv-01` | task | sv | 旋转题是怎么做的 | 产品事实 |
| 16 | `kb-task-am-01` | task | am | 词对记忆是怎么做的 | 产品事实 |
| 17 | `kb-score-01` | score | — | 分数是怎么算出来的 | `scoring/config.js` |
| 18 | `kb-score-02` | score | — | 为什么没有总分 | S12 · 产品决策 |
| 19 | `kb-score-03` | score | — | 为什么没有百分位和常模 | S12 |
| 20 | `kb-score-04` | score | — | "未测"是什么意思 | 产品事实 |
| 21 | `kb-score-05` | score | — | 复测怎么比较 | 产品事实 |
| 22 | `kb-factor-01` | factor | — | 睡眠与状态对成绩的影响 | S09 · S12 |
| 23 | `kb-factor-02` | factor | — | 设备与环境的影响 | S12 |
| 24 | `kb-factor-03` | factor | — | 练习效应 | S12 |
| 25 | `kb-limit-01` | limit | — | 这不是诊断 | S12 · S13 |
| 26 | `kb-limit-02` | limit | — | 八项不是学界公认的八种智力 | S10 · S11 |
| 27 | `kb-limit-03` | limit | — | 本期不测什么 | [算法设计](../algorithm/algorithm.md) |
| 28 | `kb-limit-04` | limit | — | 数据存在哪、怎么删 | 产品事实 |
| 29 | `kb-plan-01` | plan | — | 一般性的作息与练习建议 | S12 |
| 30 | `kb-plan-02` | plan | — | 什么时候该找专业人士 | S12 · S13 |

### 5.1 配比说明

- `dim` 12 条 = 4 个维度 × 3 条（是什么 / 受什么影响 / 不说明什么），保证任一维度被问到时至少命中 1 条；
- `task` 只有 4 条，因为任务规则本身由 UI 说明，知识块只补"为什么这么做"；
- `score` 5 条覆盖用户最高频的困惑（总分、百分位、未测、复测）；
- `limit` 4 条中有 2 条是**合规硬要求**（非诊断、不测什么），不可裁剪；
- `plan` 只给 2 条：一条一般性建议，一条转介提示。**不写具体训练方案**，避免变成疗效承诺。

## 六、来源清单（候选，全部待人工核验）

> AI 只做候选，**入库前必须由人打开原文核对**：题名、作者、年份、页码/章节是否对得上。
> 对不上的直接换源，不允许"差不多就行"。

| 编号 | 类型 | 题名 | 作者 / 机构 | 年份 | 用途 | 核验状态 |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | textbook | 心理与教育测量 | 戴海崎 等 | — | vc 语义、测量学基础 | 待核验（版本/页码） |
| S02 | textbook | 现代心理与教育统计学 | 张厚粲、徐建平 | — | 统计与分布表述 | 待核验 |
| S03 | textbook | 实验心理学 | 郭秀艳 | — | 反应时范式 | 待核验 |
| S04 | paper | The information available in brief visual presentations | Sperling, G. | 1960 | 记忆与再认范式 | 待核验 |
| S05 | paper | High-speed scanning in human memory | Sternberg, S. | 1966 | 反应时与记忆扫描 | 待核验 |
| S06 | paper | Working memory | Baddeley, A. D., & Hitch, G. | 1974 | 工作记忆模型 | 待核验 |
| S07 | paper | Mental rotation of three-dimensional objects | Shepard, R. N., & Metzler, J. | 1971 | 心理旋转 | 待核验 |
| S08 | paper | Studies of interference in serial verbal reactions | Stroop, J. R. | 1935 | 抑制控制（本期不测，仅背景） | 待核验 |
| S09 | paper | The processing-speed theory of adult age differences in cognition | Salthouse, T. A. | 1996 | 加工速度 | 待核验 |
| S10 | book | Human cognitive abilities | Carroll, J. B. | 1993 | 能力层级（CHC 前身） | 待核验 |
| S11 | book | The Cattell-Horn-Carroll theory of cognitive abilities | Schneider, W. J., & McGrew, K. S. | 2018 | 八维与 CHC 的关系说明 | 待核验 |
| S12 | org | Standards for Educational and Psychological Testing | AERA / APA / NCME | 2014 | 测试使用伦理、非诊断表述 | 待核验 |
| S13 | org | 关于应用"12356"全国统一心理援助热线电话号码的通知 | 国家卫生健康委 | 2024 | 转介通道 | 待核验（文号与链接） |

### 6.1 核验清单（每条来源逐项打勾）

- [ ] 题名与作者拼写正确
- [ ] 年份正确
- [ ] 页码 / 章节 / 卷期可定位
- [ ] 引用它的 chunk 确实能从该来源得到支持（**不能张冠李戴**）
- [ ] 若是网页，链接可访问且不是二手转载
- [ ] 版权允许摘述（教材需转述，不得整段复制）

### 6.2 特别说明

- **S13 采用 A 方案（2026-11-07 决定）**：`kb-plan-02` 只给求助通道，**不做症状判断**。
  正文不写"你可能患有…"，只写"若近期持续感到情绪低落、失眠或明显影响学习生活，可联系学校心理健康教育中心，或拨打全国心理援助热线 12356"，并紧接"本测评不提供诊断"。
  理由：转介话术一旦开始判断"什么信号算问题"，就滑向筛查，与本产品"非诊断"的定位冲突；12356 是国家级统一号码，来源稳定、可引用、不易过期。
  依据：[国家卫生健康委关于应用"12356"全国统一心理援助热线电话号码的通知](https://www.gov.cn/zhengce/zhengceku/202412/content_6994470.htm)（2024-12）。
- 教材类（S01–S03）需要**确认版次**，不同版次页码不同；
- 英文文献一律**中文译述**，不整段引用原文。

## 七、风险等级与审核流程

### 7.1 风险分级

| 等级 | 判定 | 处理 |
| --- | --- | --- |
| `low` | 纯描述性，无医学/能力断言 | 1 人审核 |
| `medium` | 涉及"能力高低""会影响成绩"等判断 | 1 人审核 + 必须在 text 内附否定表述 |
| `high` | 涉及健康、就医、诊断边界 | **2 人审核**，且必须有明确免责句 |

按本计划，`high` 只有 `kb-limit-01` 一条；`kb-plan-02` 采用 A 方案（只给通道、不做判断）后降为 `medium`。

### 7.2 流程

```text
AI 起草（status=draft）
   → Owner 核来源、改文案（status=reviewed, by/date 填写）
   → Support 抽检 30%
   → 合并入 chunks.js（version 自增）
```

未 `reviewed` 的 chunk **不得进入检索索引**，脚本层面直接过滤。

## 八、检索与评测（交给 L-06）

### 8.1 索引

| 项 | 取值 |
| --- | --- |
| 索引字段 | `title` + `text` + `tags` |
| 中文切分 | 字符 bigram（不引入分词库，零依赖） |
| 算法 | BM25，`k1 = 1.2`、`b = 0.75` |
| 返回 | top3，附 `id`、`source`、相似度 |
| 兜底 | 最高分低于阈值时返回空，Agent 说"不知道" |

### 8.2 评测（hit@3 ≥ 80%）

20 条 query，期望 top3 内出现指定 chunk。示例 8 条：

| # | query | 期望命中 |
| --- | --- | --- |
| 1 | 为什么没有总分 | `kb-score-02` |
| 2 | 空间分数低说明什么 | `kb-dim-sv-01` 或 `kb-dim-sv-03` |
| 3 | 未测是什么意思 | `kb-score-04` |
| 4 | 睡眠会影响成绩吗 | `kb-factor-01` |
| 5 | 这个结果能诊断我有没有问题吗 | `kb-limit-01` |
| 6 | 记忆题怎么做的 | `kb-task-am-01` |
| 7 | 百分位在哪里看 | `kb-score-03` |
| 8 | 数据会被上传吗 | `kb-limit-04` |

剩余 12 条在 L-06 补齐，判定口径：**top3 命中即算通过**，20 条至少 16 条命中。

## 九、交付物与验收

| 交付物 | 位置 | 验收 |
| --- | --- | --- |
| 本文档 | `docs/software/knowledge-base.md` | 评审通过 |
| 30 条 chunk | `code/frontend/src/kb/chunks.js` | 30 条、字段齐全；全部 `reviewed` 后才进索引（当前均为 `draft`，待人工核源） |
| 校验脚本 | `scripts/test_kb.js` | 字段/schema/禁用词/长度全过 |
| 检索实现 | `code/frontend/src/kb/search.js` | BM25 + top3 |
| 评测集 | `code/frontend/src/kb/queries.json` | 20 条，hit@3 ≥ 80% |

## 十、决策记录（2026-11-07）

| # | 问题 | 结论 |
| --- | --- | --- |
| 1 | `dim` 类每条 120–220 字是否偏短 | **保持 120–220**，够回答追问；不够再拆块，不靠加长 |
| 2 | S13 转介来源与写法 | **选 A 方案**：只给求助通道、不做症状判断；来源用国家卫健委 12356 通知；`kb-plan-02` 降为 `medium` |
| 3 | 30 条是否够覆盖 20 条评测 query | **够，不扩到 40**；hit@3 不达标再补 |
| 4 | 谁负责核验 13 条来源 | **xlr268**，逐项过 6.1 清单，未核验不得改 `review.status` |

## 十一、变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-07 | v1.0 | 初稿：六类分类、chunk schema、30 条计划、来源候选、评测口径 |
| 2026-11-07 | v1.1 | 按评审意见定稿：字数保持、30 条不扩、核验人 xlr268、S13 采用 A 方案（12356 通道 + 不做判断），`kb-plan-02` 风险降为 medium |
| 2026-11-07 | v1.2 | L-06 落地：30 条正文 + `search.js`（BM25/bigram）+ `test_kb.js` + `queries.json`；正文用 `chunks.js` 而非 JSON（`file://` 下 `fetch` 不可用）；全部条目 `review.status=draft`，待人审 |
