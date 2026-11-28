# 知识库增补包草稿（MoCA 关系 + 条件五件套 + 透明性）

> 评审稿。按 [ADR-0002（提议）](../adr/0002-agent-positioning-language-contract.md) 决策 1/2/3/7 起草：
> 补上「MoCA 参考范围、换算边界、定向力不做、条件解释、透明性叙事」五类语料。
> **本文件只是内容草稿，尚未写入 `chunks.js` / `kb_seed.json`，也未建迁移。**
> 评审通过后按第七节接线。

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 关联 | [ADR-0002](../adr/0002-agent-positioning-language-contract.md)、[知识库设计 MM-DES-004](knowledge-base.md) |
| 起草 | song（AI 辅助） |
| 待审 | xlr268（内容与措辞）、1213lz（检索与评测）、waibibabo666（定位） |
| 状态 | 草稿，未接线 |

## 二、动机

现有 42 块语料（dim 24 / task 4 / score 5 / factor 3 / limit 4 / plan 2）覆盖了「维度是什么、分数怎么来、为什么没有总分/百分位、练习效应」等高频问题，但 ADR-0002 定下的四件事没有对应素材：

1. **与 MoCA 的关系**：用户问「这是不是 MoCA」「和 MoCA 比怎样」时，检索必然落空，Agent 只能说不猜；
2. **换算边界**：「换算成 MoCA 多少分」必须能明确拒绝，且解释为什么（当前靠校验器拦数字，没有可引用的话术）；
3. **条件解释的五件套**：状态（已有睡眠/设备）、策略（快准取舍）、任务设计（限时与题量）、情境（备考期）、测量局限（练习效应已有）——缺策略、任务设计、情境三块；
4. **透明性叙事**：「没有常模，结果还有什么用」是答辩与用户的第一质疑，需要正面回答。

## 三、新增清单（15 块）

| # | id | 分类 | dims | 标题 | 风险 | 解决什么 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `kb-limit-05` | limit | — | 和 MoCA 是什么关系 | medium | 域框架参考、计分不采用 |
| 2 | `kb-limit-06` | limit | — | 为什么不测定向力 | medium | 坦率例外，防「为什么缺一项」 |
| 3 | `kb-score-06` | score | — | 能换算成 MoCA 分吗 | high | 换算拒绝 + 解释 |
| 4 | `kb-score-07` | score | — | 没有常模还有什么用 | medium | 透明性叙事 |
| 5 | `kb-factor-04` | factor | — | 快与准的取舍 | medium | 策略条件 |
| 6 | `kb-factor-05` | factor | — | 限时任务的设计 | medium | 任务设计条件 |
| 7 | `kb-factor-06` | factor | — | 备考期与压力 | medium | 情境条件 |
| 8 | `kb-dim-vc-04` | dim | vc | 言语理解对应哪个域 | low | 域映射 |
| 9 | `kb-dim-vf-04` | dim | vf | 言语流畅与流畅性范式 | low | 域映射 |
| 10 | `kb-dim-nc-04` | dim | nc | 数字运算与系列减七 | low | 域映射 |
| 11 | `kb-dim-ps-04` | dim | ps | 知觉速度与加工速度 | low | 域映射 |
| 12 | `kb-dim-ir-04` | dim | ir | 归纳推理与抽象 | low | 域映射 |
| 13 | `kb-dim-sv-04` | dim | sv | 空间视觉与视空间执行 | low | 域映射 |
| 14 | `kb-dim-am-04` | dim | am | 联想记忆与延迟回忆 | low | 域映射 |
| 15 | `kb-dim-ni-04` | dim | ni | 自然知识为什么不挂 MoCA | low | 坦率例外 |

新增后分类计数：`dim 32 / task 4 / score 7 / factor 6 / limit 6 / plan 2`（共 57）。与 ADR-0002 的「约 12–16 块」一致。

## 四、chunk 正文（待审）

```json
[
  {
    "id": "kb-limit-05",
    "category": "limit",
    "dims": [],
    "title": "和 MoCA 是什么关系",
    "text": "我们借鉴 MoCA 的认知域划分来组织测评的覆盖面：语言、记忆、注意、视空间与抽象在两边都有对应任务。但分数体系是自建的，不采用量表的计分方式与分界值，任务也按线上自测重写；范式来源是各领域的经典研究，而不是复刻整套量表。本测评不用于筛查或诊断，也不提供任何量表分值的换算。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "medium",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["MoCA", "量表", "关系"],
    "param": null
  },
  {
    "id": "kb-limit-06",
    "category": "limit",
    "dims": [],
    "title": "为什么不测定向力",
    "text": "时间与地点定向是临床认知检查里的固定项目，主要用于识别意识与定向状态的急性异常。面向日常自测时，它既难以区分正常波动，也会把产品引向筛查工具，因此本期不做。报告里不会出现定向力分数，也不会用「记不清今天几号」这类现象推断健康状态；如有持续困扰，应咨询专业人员。",
    "source": {
      "kind": "product",
      "title": "MindMeter 产品边界：非临床定位与语言契约",
      "author": "MindMeter 团队",
      "year": 2026,
      "locator": "ADR-0002 决策 2"
    },
    "version": "1.0",
    "risk": "medium",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["定向力", "边界", "临床项"],
    "param": null
  },
  {
    "id": "kb-score-06",
    "category": "score",
    "dims": [],
    "title": "能换算成 MoCA 分吗",
    "text": "不能。本产品的分数只表示本次任务里的表现，与 MoCA 等量表的题目、计分与分界值都不同，任何「相当于多少分」的换算都会制造一种并不存在的判定精度。看到网上的换算表也不要拿来对照。真正需要量表评估时，应由专业人员当面施测并解读；这份报告只帮助你回看自己的记录与变化。",
    "source": {
      "kind": "org",
      "title": "Standards for Educational and Psychological Testing",
      "author": "AERA / APA / NCME",
      "year": 2014,
      "locator": "第 2 章 分数的解释与使用边界"
    },
    "version": "1.0",
    "risk": "high",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["换算", "MoCA", "解释边界"],
    "param": null
  },
  {
    "id": "kb-score-07",
    "category": "score",
    "dims": [],
    "title": "没有常模还有什么用",
    "text": "有用，但用途不同。没有常模，就不能说你在人群中排在什么位置；能说的是同一维度的多次记录之间可以比较、同一套计分规则可以复现、作答过程与指标都能回看。把每次结果当成一次带条件的记录，配合 7 天以上间隔的复测，看到的是自己的稳定区间与波动来源，而不是排名。",
    "source": {
      "kind": "org",
      "title": "Standards for Educational and Psychological Testing",
      "author": "AERA / APA / NCME",
      "year": 2014,
      "locator": "第 2 章 分数的解释与使用边界"
    },
    "version": "1.0",
    "risk": "medium",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["常模", "自我基线", "复测"],
    "param": null
  },
  {
    "id": "kb-factor-04",
    "category": "factor",
    "dims": [],
    "title": "快与准的取舍",
    "text": "速度类任务在快与准之间有天然取舍：追求速度容易牺牲判断，放慢则会减少作答量，两种策略下总分可能接近。某次速度或正确率偏向一边，更多是策略造成的，而不是能力突然变化。想让结果更稳，可以在练习里固定一种策略，例如先确认再作答，再看两周内的变化。",
    "source": {
      "kind": "paper",
      "title": "The processing-speed theory of adult age differences in cognition",
      "author": "Salthouse, T. A.",
      "year": 1996,
      "locator": "Psychological Review, 103(3), 403–428"
    },
    "version": "1.0",
    "risk": "medium",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["策略", "速度", "准确率"],
    "param": null
  },
  {
    "id": "kb-factor-05",
    "category": "factor",
    "dims": [],
    "title": "限时任务的设计",
    "text": "限时任务的成绩同时受题目设计影响：时限长短、题量与呈现方式都会改变速度与准确率的关系。同一能力在不同设计下分数不同，因此不适合跨产品直接比较；复测时保持一致的设计，差异才可比。本产品把时限与题量写进任务说明，你可以在报告里找到这次的具体条件。",
    "source": {
      "kind": "product",
      "title": "MindMeter 任务说明：限时与题量",
      "author": "MindMeter 团队",
      "year": 2026,
      "locator": "任务说明与报告页原始指标"
    },
    "version": "1.0",
    "risk": "medium",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["限时", "题量", "任务设计"],
    "param": null
  },
  {
    "id": "kb-factor-06",
    "category": "factor",
    "dims": [],
    "title": "备考期与压力",
    "text": "备考、考试周或工作高压期，注意资源会被占用，限时与记忆类任务更容易波动。这通常是当下的资源分配问题，而不是能力的长期变化。若你正处在这种阶段，可以先把它记进情境备注，等节奏恢复后再复测，再判断差异是否稳定；单次偏低不必急着归因到自己身上。把变化放回情境里看，比单独盯着一个数字更可靠。",
    "source": {
      "kind": "product",
      "title": "MindMeter 解读规则：情境因素",
      "author": "MindMeter 团队",
      "year": 2026,
      "locator": "解读规范：情境条件与归因边界"
    },
    "version": "1.0",
    "risk": "medium",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["备考", "压力", "情境"],
    "param": null
  },
  {
    "id": "kb-dim-vc-04",
    "category": "dim",
    "dims": ["vc"],
    "title": "言语理解对应哪个域",
    "text": "MoCA 的语言域包含命名与句子复述，看的是常见事物的唤起与句法表达的完整性；本项用词义辨析，看的是词汇关系与语义判断。两者同属语言与知识储备这一侧，但前者偏唤起与表达，后者偏理解与辨析。知道这个差别，就不必把本项成绩直接对齐到语言类的量表表现上。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["语言", "命名", "域映射"],
    "param": null
  },
  {
    "id": "kb-dim-vf-04",
    "category": "dim",
    "dims": ["vf"],
    "title": "言语流畅与流畅性范式",
    "text": "言语流畅性是经典范式：限定时间说出符合要求的词，看有效词的产出速度与组织方式。MoCA 也在语言域里放了一个限时词语流畅任务，两者属于同一族范式，但计分与时限不同，不能互相换算。本项关注的是你组织与提取词语的过程，重复词和跑题词不计入。若某次说出的词明显变少，先看看当时是否分心，或环境是否嘈杂。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["流畅性", "范式", "域映射"],
    "param": null
  },
  {
    "id": "kb-dim-nc-04",
    "category": "dim",
    "dims": ["nc"],
    "title": "数字运算与系列减七",
    "text": "MoCA 的注意域用系列减 7 来观察心算与注意的维持；本项用整段算术题，看计算的速度与准确。两者都依赖基本的数感与工作记忆，但前者是连续减法的节奏，后者是逐题计算，结果不应互相推断。整段计算也更接近日常做题的情境，会受草稿纸与心算习惯影响。若某次明显偏低，先看当时是否被打断或赶时间。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["数字", "系列减七", "域映射"],
    "param": null
  },
  {
    "id": "kb-dim-ps-04",
    "category": "dim",
    "dims": ["ps"],
    "title": "知觉速度与加工速度",
    "text": "MoCA 的数字符号编码与连线任务属于加工速度的经典测法；本项用限时的符号匹配，测的是在时间压力下快速比较与判断的能力。加工速度在成年后会随年龄缓慢变化，也受睡眠与情绪影响，所以单次结果适合与自己比较。它不是反应时越短越好，还要结合正确率一起看。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["加工速度", "符号", "域映射"],
    "param": null
  },
  {
    "id": "kb-dim-ir-04",
    "category": "dim",
    "dims": ["ir"],
    "title": "归纳推理与抽象",
    "text": "MoCA 的抽象域用词语相似性来看归纳与概括，例如两个事物同属哪一类；本项用规律归纳题，要求从例子里找出共同规则。两者都是把具体信息收紧成抽象关系，但本项的规则更接近图形与序列推理。若这类题费力，通常不是词汇问题，可以先把例子并排比较再总结。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["抽象", "规则", "域映射"],
    "param": null
  },
  {
    "id": "kb-dim-sv-04",
    "category": "dim",
    "dims": ["sv"],
    "title": "空间视觉与视空间执行",
    "text": "MoCA 的视空间与执行域包括画钟、立方体临摹与连线，强调在纸上完成的空间组织；本项是心理旋转，要求判断旋转后的图形是否一致。两者都依赖空间表征，但本项更依赖图像在头脑中的旋转操作，纸笔临摹的经验帮助有限。空间表现也受屏幕尺寸与作答方式影响。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["视空间", "心理旋转", "域映射"],
    "param": null
  },
  {
    "id": "kb-dim-am-04",
    "category": "dim",
    "dims": ["am"],
    "title": "联想记忆与延迟回忆",
    "text": "MoCA 的记忆域是五词表的即时与延迟回忆；本项用词对联想再认，既看命中，也看虚报。回忆要求主动提取，再认只需判断见过与否，因此两者不能互相换算。词对联想把两个词绑在一起，回想时可由一个词带出另一个。虚报多说明判断多靠眼熟而非确实记得，这个指标比命中数更值得关注。",
    "source": {
      "kind": "paper",
      "title": "The Montreal Cognitive Assessment, MoCA: a brief screening tool for mild cognitive impairment",
      "author": "Nasreddine, Z. S., et al.",
      "year": 2005,
      "locator": "Journal of the American Geriatrics Society, 53(4), 695–699"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["再认", "延迟回忆", "域映射"],
    "param": null
  },
  {
    "id": "kb-dim-ni-04",
    "category": "dim",
    "dims": ["ni"],
    "title": "自然知识为什么不挂 MoCA",
    "text": "自然知识没有对应的 MoCA 认知域：MoCA 覆盖的是临床常用的语言、记忆、注意、视空间与抽象等域，不做物种分类，也不测生物常识。本项的依据是分类归纳与语义知识方面的研究，属于知识储备一侧。对外说明时我们不会把它包装成量表里的某一项，免得读者误以为整个测评都来自 MoCA。",
    "source": {
      "kind": "product",
      "title": "MindMeter 产品边界：自然知识与量表参考范围",
      "author": "MindMeter 团队",
      "year": 2026,
      "locator": "ADR-0002 决策 2"
    },
    "version": "1.0",
    "risk": "low",
    "review": { "status": "draft", "by": "", "date": "" },
    "tags": ["自然知识", "边界", "域映射"],
    "param": null
  }
]
```

## 五、新增评测查询（检索 hit@3）

现有 [queries.json](../../code/frontend/src/kb/queries.json) 20 条，拟增 11 条（总数 31；hit@3 目标不变，≥80%）：

| # | query | 期望命中 |
| --- | --- | --- |
| 21 | 这个测评和 MoCA 是什么关系 | `kb-limit-05` |
| 22 | 为什么没有测定向力 | `kb-limit-06` |
| 23 | 能不能换算成 MoCA 的分数 | `kb-score-06` |
| 24 | 没有常模这个结果还有什么用 | `kb-score-07` |
| 25 | 速度类的题为什么有时准有时慢 | `kb-factor-04` |
| 26 | 限时任务的设计会影响成绩吗 | `kb-factor-05` |
| 27 | 备考期间成绩会波动吗 | `kb-factor-06` |
| 28 | 言语流畅和量表里的命名一样吗 | `kb-dim-vf-04` |
| 29 | 数字运算对应哪个认知域 | `kb-dim-nc-04` |
| 30 | 空间旋转和画钟任务有关系吗 | `kb-dim-sv-04` |
| 31 | 自然知识和 MoCA 哪个域对应 | `kb-dim-ni-04` |

## 六、风险与评审要点

1. **MoCA 版权**：只做构念层描述，不引用题目原文、不列具体题项（如「狮子犀牛骆驼」）；第 1/8–15 块的来源是 2005 年原论文，属合理引用范围。
2. **换算与诊断词**：`kb-limit-05`、`kb-limit-06`、`kb-score-06` 出现「诊断」，需要 [test_kb.js](../../scripts/test_kb.js) 的 `ALLOW` 白名单按 id 放行；`kb-score-07` 出现「常模」，同样放行。**这是内容审核的第一处重点**（放行是否过宽）。
3. **「条件」的边界**：factor-04/05/06 都在讲「这次表现受什么影响」，评审时请确认没有滑向「所以低分没关系」的免责口吻；每块都保留了行动指向（固定策略、保持设计一致、记录情境）。
4. **域映射的方法论口径**：映射块只说「同一族范式/同侧能力」，不写「等价」「相当于」；第 8 块特别点明「不必把本项成绩对齐到量表表现」。
5. `kb-limit-06` 的「定向力」与危机话术无关，不与 `kb-plan-02` 的求助通道重复。

## 七、评审通过后的接线清单

| 步骤 | 文件 | 说明 |
| --- | --- | --- |
| 1. 写入语料 | `code/frontend/src/kb/chunks.js` | 15 条，`review.status` 先 `draft`，人审后改 `reviewed` |
| 2. 分类计划 | `scripts/test_kb.js` | `CATEGORY_PLAN` 改为 `dim 32 / task 4 / score 7 / factor 6 / limit 6 / plan 2` |
| 3. 受限词白名单 | `scripts/test_kb.js` | `ALLOW` 增加 4 条：limit-05/06、score-06（诊断）、score-07（常模） |
| 4. schema 修正（顺手） | `code/frontend/src/kb/chunk.schema.json` | `dims` 枚举补 `vf/nc/ir/ni`（现为 4 维，与 8 维语料不一致，属既有漂移） |
| 5. 导出 seed | `node scripts/export_kb_seed.mjs` | 42 → 57 条 |
| 6. 迁移 | `code/backend/alembic/versions/0008_*.py` | 按 0006 的 upsert 模式新增 15 条 |
| 7. 评测集 | `code/frontend/src/kb/queries.json` | 20 → 31 条 |
| 8. 设计文档 | `docs/software/knowledge-base.md` | 版本 v1.3：分类计数、来源清单补 MoCA 2005、变更记录 |

> 全部接线完成后跑 `python -m pytest tests/unit tests/integration`、`npm test`、`python scripts/check_docs.py`，CI 全绿再合并。
