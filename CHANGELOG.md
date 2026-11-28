# 变更日志

本文件记录 MindMeter 所有值得说明的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布] — Agent 心智画像、走势板块、游戏质量与计分 scoring-v3.3

围绕人工测试反馈的四件事：回答只有分数和模板、引用显示成知识库编号、走势图空白且信息贫乏、
乱点的数据没人拦。

### Agent

- **心智画像层**（`app/agent/mind_profile.py`，新模块）：代码先把本次指标与趋势按规则翻成有依据的描述
  （整体形态、心智侧面、作答风格如「先准再快」「靠重试」、与上次相比），模型只负责组织语言。
  画像进 prompt 与模板兜底，记忆页新增「AI 眼中的你」（`GET /memory/mind-profile`，不调用模型）。
- **放宽红线**（此前的限制让回答只能复述数字）：允许「相对突出/靠后/偏向」这类倾向描述，
  「表现较好」这类绑定本次任务的说法放行；机制推测从硬失败降为只记遥测（soft）。
  **仍然禁止**：临床词、量表换算、智商/天赋/人格、「能力较强」这类稳定能力定级、人群对比。
  旧测试里断言被放宽红线的 9 项已按新口径改写，没有删除。
- **引用不再显示知识库编号**（`app/agent/display.py`）：用户可见文本去掉 `kb-…` 编号，
  正文里残留的编号换成知识块标题；来源只保留回答正文**真正写到**的知识块
  （此前把检索到的全部块都挂上，包括没用到的）。内部校验与记忆沉淀仍用原始编号。

### 趋势与走势板块

- **练习效应提示不再劝用户等一周**：间隔 1–6 天照常展示变化，只补一句「练习效应可能参与其中」；
  同一天复测单独说明。7 天是保守线，不是比较的门槛。
- **走势板块重做**：横轴按真实日期（此前按次数等距，隔 1 天和隔 6 天画成一样）；
  每个维度一张小图，变化最大的排前面；加「你自己的波动范围」（此前至少 3 个更早的点，平均 ± 一个标准差，
  半宽不小于 3 分）；每张图一个「让 Agent 解释这个变化」入口。
- **修复走势图空白**：折线与圆点的初始样式是隐藏、靠入场动画显示，而全局规则在系统开了
  「减少动态效果」时关掉动画，于是只剩坐标轴。隐藏态现在只在 `prefers-reduced-motion: no-preference` 里。

### 游戏质量

- 新增 `game_plays` 表（迁移 `0008_game_plays`，**部署时需要 `alembic upgrade head`**）记录每局成绩；
  `app/game_quality.py` 在小样本下持续更新后验：极端组 D 的贝叶斯序贯判断、天花板/地板的 Beta 可信区间、
  同维度游戏 pooled 先验、限制性 2PL 兜底；`GET /games/quality` 只返回聚合。
  未迁移时游戏照常记分，只是不产生流水。**这套阈值尚未用真实数据校准。**

### 计分 scoring-v3.3

人工审查「用户乱点会得到什么数据」时发现：服务端完全信任客户端上报的指标，
且归纳推理、自然知识没有猜测校正。用评分引擎模拟纯随机作答（标准档题量）：
ir 平均 25 分、95 分位 50 分；伪造 `correct: 80, total: 8` 与 `encCorrect: 9999` 都得 100 分。

- **ir/ni 补猜测校正**：ir 四选一按 0.25；ni 现行题型（生物分类）是三选一，按 1/3。纯猜平均分从约 25/33 降到约 8/10。
- **作答合法性校验**（Python 与 JS 两端同口径，`_choice_score` / `scoreChoice` 逐行对应）：
  计数为负或非有限数、正确数超过总数、总题数超过该档发放数、限时任务作答速度超过人类上限
  （ps 5 次/秒、vf 4 词/秒）一律记 `null`。记 null 而不是封顶：封顶会把伪造数据变成「满分」。
  上限放在 `CONFIG`，不是计分参数。
- 版本号 `scoring-v3.2` → `scoring-v3.3`；算法文档补充版本说明。

### 文档与汇报

- **汇报幻灯片**（`docs/slides/`）：Slidev 27 页，严格按课程考核编号 1.1.1–3.7.2；含制作 → 内容审核 → 评分
  的工作 loop（`review.md` + 静态审计 `tools/audit.mjs` + 渲染检查 `tools/render-check.mjs`）、
  离线启动 `start.cmd`、PDF 导出脚本；需要作者提供的截图位置一律留空占位。
- **文档对齐当前实现**：问题定义、功能需求、用户故事、Agent 设计与软件设计总览更新为站点统一模型、
  用户名+密码 + Cookie 会话、F-28 站点托管 AI、F-32 游戏中心；幻灯片 1.1.4 获客渠道补充小红书/B 站/抖音。

### 已知影响

- **v3.2 与 v3.3 的 ir/ni 分数不可直接比较**：已有记录不会重算，跨版本的趋势里这两个维度会出现
  由口径变化造成的下降，Agent 也可能据此解释成「下降」。空间视觉化线上走加权路径，原本就有 0.25 校正，不受影响。

## [0.3.6] - 2026-11-20 — 意图路由加 LLM 兜底（第 3 轮遗留项 1）

用户问「回答不满意是 LLM 选型还是 agent 架构的问题」。前一轮已证明主因是架构；这一轮把架构上
真正缺的那块补上：**关键词规则写不完表达，模糊时交给模型判，但模型的判定必须被系统约束。**

### 新增

- **LLM 兜底意图分类**（`app/agent/intent_llm.py`，新模块）：关键词落到 `clarify`/`unrelated`/`greeting`
  时发一次小请求（`max_tokens=16`、超时 6s、temperature 0、带最近 4 条上下文），把问题归到闭集意图。
  典型收益：「我跟以前比呢」以前只能回"你指的是哪一项？"，现在正确路由到趋势解释。
- **四条不变式**（`classify.resolve_intent`，纯函数、可离线测）：
  1. **安全红线不可降级** —— 危机/越界/高风险领域/疏导/自责由关键词决定，模型无权改判；
     `crisis` 甚至不在模型的可选集合里（危机必须靠词表命中，不能靠模型"识别情绪"）。
  2. **只在模糊时调用** —— 关键词已命中领域词/趋势语境/建议诉求时不发请求，
    实测这类问题分类开销 0ms，不给正常对话加延迟。
  3. **闭集 + 失败即回退** —— 未配置模型、超时、返回不可解析或闭集外的值，
     一律沿用关键词结果：这个功能坏掉时，行为与没有它时完全一致。
  4. **改判必须与可支撑的数据相容**（真实模型实测后加）—— 只有一次记录时不许路由到 trend，
     没有测评结果时不许路由到 explain/summary。
- **路由可观测性**：`POST /chat` 的 `reply` 新增 `intentSource`（`rule`/`llm`/`scene`），
  调路由时能直接看到是哪条路径决定的，不再靠猜。

### 修复（都是实测暴露的误判，不是假想）

- **模型硬猜指代**：「那个呢」被猜成 trend，用户收到"这个账号还没有两次可比的测评" —— 比原来的
  追问更误导。由不变式 4 拦住：同一句话在 1 条记录时保持 clarify，在 2 条记录时才升为 trend。
- **情绪困扰被当成指代不清**：「我有点担心自己」「最近状态一直不好」以前回"你指的是哪一项？"，
  现在由关键词直接判为 support（共情 + 两周阈值 + 求助渠道 + 明确不诊断），且不再需要问模型。
  「焦虑症」仍由 BOUNDARY 词表先命中，顺序在前，不会被 support 抢走。
- **可靠性追问被误判为倾诉**：「这东西准吗」被模型判成 support，回了"听起来你最近状态不太好"。
  改为关键词直接接住（准吗/可信/靠谱/信度/效度/误差/科学吗 → explain），不给模型猜错的机会。
- **过期文案**：无知识命中话术里的"本地知识库"（桌面时代遗留）改为"站点内置的知识库"。

### 测试

- 后端 318 → **330 项**（新增 `tests/backend/test_intent_routing_llm.py`）：四条不变式逐条钉住、
  安全意图永不被改判、关键词确定时**断言模型根本没被调用**（延迟预算）、失败路径与"没有该功能"
  等价、闭集外取值不采纳、support/可靠性/临床词三类路由边界、报告场景跳过分类。
- 前端 160、Playwright 15、部署冒烟 22/22、生产参数预检 11/11、三个静态门禁：全绿未变。
- 真实模型端到端实测（1 条记录 vs 2 条记录两种数据状态）：情绪句 0.0s 关键词命中、
  「这东西准吗」0.0s 关键词命中、「那个呢」两种状态下均不再被硬猜、
  「我跟以前比呢」在有两次记录时 `source=llm` 且模型正常作答。

### 已知未做（不阻塞部署，按价值排序）

- 「这东西准吗」虽然路由对了，但 BM25 对这种几乎没有内容词的问法**召回为空**，
  落到 `no_knowledge` 模板（回答诚实但没用）。需要一层受控的查询扩展或给 limit 类条目补同义标签。
- 窄屏浮框被视口左缘裁掉；极矮视口 sticky 输入框盖住页尾免责句；
  跨维度的非分数指标混用仍只靠提示词缓解（不是硬拦）；雷达/折线 SVG 文字在 360px 下偏小。

## [0.3.5] - 2026-11-20 — 人工测试反馈第 3 轮（回答仍退模板 / 字号 / 清空对话 / 冗余信息）

用户这轮问的是："这与我们选择的 LLM 有关系，还是我们的 agent 架构有关系？"
**答案：主因在架构，不在模型。** 证据是同一个 `glm-4-flash-250414`，只改我们这边的规则，走模型率就从 2/16 升到 14/16。

### 修复

- **能力评级措辞不再整条丢弃（反馈3 主因之一）**：问「我哪方面比较强」时模型 4/4 次都写「表现较好」——它在镜像用户措辞，提示词教不动。旧处理是 hard 判死退回模板，于是这个问题**永远**看不到模型答案。现在：当且仅当全部 hard 问题都是评级措辞时，**改写措辞（`表现较好` → `本次分数相对较高`）后重新校验**，通过就保留内容，`code=wording_repaired`。数字无依据、跨维度、机制编造、临床词（诊断/治疗/抑郁）**一律不改写** —— 那些不是措辞问题。实测该问题 0/4 → **4/4**。
- **禁用词误伤免责句**：模型写「这不是诊断结论」被裸词表判 hard，正确的趋势回答退成模板；而系统自己补写的固定声明含同一个"诊断"却合法 —— 等于"只许官方免责，不许模型免责"。现在 `banned_word_hits()` 与评级词同一套规则：命中词前 10 字窗口内有否定线索（不/未/无/非/别/莫…）即视为免责放行；窗口收窄避免被远处一个"不"字洗白。实测 4 句免责全放行、4 句真越界全拦下。
- **`score_misattributed` 的两个误伤源（我 0.3.4 引入）**：① 校验词表用简称（`空间视觉`）、归属表用全称（`空间视觉化`），按字符串比对必然不等 → 把正确回答判死；② 趋势句「归纳推理 25 → 50」里的 25 是 ir 的**上次**分数，归属表只登记本次分数时会把它认成别的维度的数字。现在统一按**维度 id** 比对，并把趋势的 `prev/next/delta` 都登记进归属表。真错（把 ir 的 50 写进联想记忆句子）仍然拦。
- **意图路由两个缺陷**：① 强词「比较」把「我哪方面比较强」整句吃掉路由到趋势，回一段两次分数差值 —— 答非所问；现在「比较」降级为弱词，必须与"两次/上次/复测"同现才算趋势。② 「我有什么优点 / 我擅长什么 / 我哪个维度最好 / 我有什么不足」全部落到 clarify（要用户自己说出维度名）；新增 `STRENGTH_WORDS` 路由到 summary（只描述本次相对高/低的维度，不做能力评价），并放在趋势分支之后，保证「这两次哪项比较强」仍走趋势。实测 13/13 路由正确。
- **`DELETE /memory` 不删对话（语义缺口）**：记忆页「清除全部记忆」调它，但它只删 advice + summaries 并重置画像，**完全不删 `ChatMessage`** —— 对话一条不少地留着，而界面写的是"删除后 AI 不会再引用"。属于承诺与实现不一致（课程测试表 A7）。现在它删全部四类；另补 `DELETE /memory/messages`（**只**清对话）供对话页的「清空对话」使用，前端从"最多 20 次串行单条删除"降为一次调用，并保留逐条兜底以兼容旧部署。
- **提示词补齐两处**：summary 场景明确教"强项问题该怎么措辞"（点名 `表现最好` 会被自己的红线判死）；引用纪律改为注入本轮真实 kb 编号清单，避免模型照抄占位符。

### 新增

- **对话页「清空对话」入口 + 输入框首屏可见（反馈1）**：按钮带条数（`清空对话（20）`）、`aria-label`、二次确认里当面说清"只删对话，摘要/建议/画像都不删"；消息流改为有上限的滚动容器（`max-height: min(44vh, 520px)`）并在进入/发送后滚到底，输入块 `position: sticky; bottom: 0`。实测 1280×900 输入框底边 409、360×640 底边 503（均在首屏内），横向溢出 0。清空与发送互斥，避免一次清空把刚发出去的那条一起删掉。
- **字号整体上调（反馈2）**：`:root` 新增 6 档字号变量（`--fs-xs 13.5 / --fs-sm 14 / --fs-md 15 / --fs-body 16 / --fs-lg 17 / --fs-xl 26`），CSS 里 80 处 `font-size` 改为引用变量，页面 JS 里最后一处硬编码字号也搬进 `.mem-action`。正文 15→16、`.tiny` 12→13.5、`.muted` 13→14、页标题 24→26、卡片标题 16→17、AI 回答 13.5→16、题干 24→26、选项 17→18。**stimuli 类大字（题干数字、符号、舒尔特格）不动**，避免改变任务本身的难度。
- **档位卡去掉零区分度信息（反馈4）**：三张卡下面逐字重复的 8 个维度名删除，改为从 `src/scoring/levels.js` 的 `LEVEL_SPEC` 现算的差异数字（`共 36/58/66 题`、`言语 4/8/12 题`、`知觉 30/45/90 秒`…），零手写常量；`am/nc/ir/ni` 在标准与精细之间取值相同，因此**不列**（列了就是噪音）。"三档测同样的 8 个维度、只差题量与限时"只在页标题浮框里说一次。新增 `tierMetrics(tier)` 供单测断言三档互异。
- **全站冗余排查（反馈4 要求的"检查其他地方"）**：14 项清单逐条处置 —— 游戏卡每张重复的「未玩过」徽章删掉（无徽章即未玩过）、记忆页空态与浮框互相复述删掉空态那句、对话页空态与 placeholder 同句删掉、设置页 4 处 label/placeholder 同义改留增量、游戏页 h1 与卡片 h2 重复游戏名删卡片标题、侧栏/右栏/顶栏三处重复同一组口径各留不重叠的部分、报告页未测占位行合并成一行 `<details>`。**没有为"去冗"动任何合规文案**：知情同意三句、高风险与回退原因、等待三阶段、做题指令全部常驻，`tasks/**`、`games/**` 仍禁用浮框。

### 测试

- 后端 268 → **275 项**：新增措辞改写契约（含"数字必须原样保留"）、临床词不改写、免责句放行/真越界拦、否定窗口不过宽、趋势句不误伤（简称/全称 + prev/next/delta 两类）、强项问题路由、`DELETE /memory` 删全部四类、`DELETE /memory/messages` 只删对话。
- 前端 155 → **160 项**（`copy discipline` 新增第 7 条门禁，把冗余处置钉成回归防护；既有阈值一个没放松）。
- Playwright e2e 11 → **15 项**：新增对话页 sticky 与清空语义（断言服务端 `messages=0` 而 `summaries/advice` 保留）、三张档位卡文本互异、字号变量生效、八维表未测折叠。360px 溢出断言阈值仍为 `≤1`。
- 冒烟 22/22；三个静态门禁与 Prettier 全绿。
- 真实模型端到端复测（4 轮 × 4 问）：「我有什么优点」4/4、「我哪方面比较强」4/4、「为什么联想记忆低」4/4、「这两次有什么变化」2/4 —— 后两条回退原因分别是 `unsourced_number` 与 `too_long`，属**真该拦**（模型编了数字 / 写超字数），模板兜底内容正确。

## [0.3.4] - 2026-11-20 — 人工测试反馈第 2 轮（回答质量 / 界面精简 / 趋势合并 / 等待动画）

对照课程《智能体 Demo · 用户测试表》的 A1–A11 维度处理四条反馈。最意外的发现是：**"回答不满意"的根因不是模型能力，而是我们自己的校验器把正确回答误杀了**。

### 修复

- **派生数字白名单过窄（反馈1 真根因，严重）**：模型把 1870ms 写成「1.87 秒」、把 5/8 写成「62.5%」、把 21/24 写成「87.5%」——都是合法换算与派生，却被 `unsourced_number` 判 hard 回退模板。实测修复前 **0/9** 走模型，修复后 **9/9**。新增显式变换（全部离散、**不做容差匹配**，容差会打开幻觉数字的口子）：毫秒→秒保留 1–2 位小数（1870 → 1.87/1.9/2，**1.873 不放行**）、百分比新增 1 位小数派生、四舍五入改为十进制 half-up（`round(2.5)` 给 2、`round(62.5)` 给 62 这两处本身就是误杀）、全角数字与千分位归一（`1,870 毫秒` 不再被切成 1 和 870）。
- **中文数字绕过校验（真实模型实测发现）**：模型把 `meanRtMs 2500` 写成「平均用时两分五十秒」= 170 秒，`extract_numbers` 完全看不见中文数字 —— 这是**实打实的错数字**。现在中文的 `N秒 / N毫秒 / 百分之N / N分N秒` 会换算成数值再走同一张白名单：「两分五十秒」→ 170 → hard 拦；「四十五秒」「一点八七秒」「百分之六十二点五」→ 放行（不搞一刀切，否则又退化成模板）。
- **跨维度指标抄用**：模型把 ps 的 `12/2/1880` 抄进讲联想记忆的句子（数字都在 facts 里，白名单看不见）。喂给模型的指标行改为「联想记忆（am）: {…}」并在提示词点名维度行归属。
- **建议记录抽取失效（反馈1 核心功能）**：抽取器只认模板的 `· 正文（引用：kb-xxx）` 格式，模型实际写「练习建议：1. 专注建立联系：…」时全部抓不到 → 对话完 `advice=0`。扩展为覆盖编号列表 / `标题：正文` / 小节标题下条目，实测 **advice 从 0 → 6**，且摘要里"已给 6 条建议"与实际条数一致。
- **提示词占位符被字面复读**：`引用：知识块编号 · 标题` 被模型当内容抄出来（还截断成 `kb-dim-am-`）。改为注入真实编号，并新增 `citation_placeholder` soft 标记与"引用行必须含真实 kb id"检查。
- **机制编造与特质归因**：模型写出「可能存在一定的混淆或回忆效率有待提升」「1 次是符号类别错误（属于目标符号本身错误）」——给指标编造未给出的含义，违反 ADR-0002。新增窄规则 `mechanism_speculation`（hard，回退模板），并钉住三句正常表述不得误伤。
- **`config.py` 里 `llm_model_fallbacks` 重复声明**：第二次 `= ""` 覆盖默认值，等于备用模型降级链在生产里**静默失效**、一次 429 就整站回模板（0.3.3 我自己埋的雷，由子 agent 抓出）。
- **`ui.js` 的 `emptyState({ hint })` 形参遮蔽模块级 `hint()`**：改名 `hintText` 拆雷；`pages/auth.js` 的 `field(label, control, hint)` 同步改名 `note`。
- **`data.js` 的 `LIMITS[0]` 过期口径**：仍写「本机临时折算（local-provisional-v1）… 本页不参与最终计分」，与现行"服务端 scoring-v3.2 唯一权威"矛盾，且这句话出现在说明页。改为「分数由服务端按 scoring-v3.2 折算，前端只做同口径的即时展示；两者不一致时以服务端为准」。
- **`about.js` 过期声明**：「标准档只测前 4 项」→ 实际三档都测 8 项，只有题量/时长不同。

### 新增

- **对话后自动沉淀记忆（反馈1，核心功能）**：新增 `app/agent/insights.py`。`MemorySummary` 按「同一测评 + 当天」upsert（确定性中文，数字只来自 facts）；`MemoryAdvice` 双路提取 + kb 编号/内容哈希去重 + 归一化文本二次比对，**用户勾过的 `done` 永不被覆写**；画像只在 `confirmed=True` 时才写，未确认只回传 `profileSuggested` 线索（未确认不写是硬规矩）；环形上限摘要 20 / 建议 30；危机、越界、疏导、pii、澄清、寒暄轮次**一律不落记忆**（记忆会被导出、会被下一个人看到，把情绪话题沉淀成"长期档案"与 A7 隐私承诺相反）。
- **`POST /chat` 返回整份 `memory` + `memoryUpdated` + `profileSuggested` + `validation`**：前端因此改为**直接采用服务端返回**，不再 `PUT /memory` 全量快照 —— 旧写法会先 DELETE 本账号 summaries/advice 再按客户端缓存重写，把刚沉淀的行抹掉（用户表现为"记忆又空了"）。
- **记忆写路径全部定向化**：`addSummary`/`addAdvice`/`recordAdvice`/`setAdviceDone`/`removeMemory` 改用单行 upsert 与单行删除接口，新增 `DELETE /api/v1/memory/messages/{id}`；`PUT /memory` 仍保留给导入/清除路径。
- **报告与趋势合并（反馈3）**：`#/report` 新增「与上次相比」区块 —— 只有一次测评时显示**基线态**（「这是这个账号的第一次记录」+ 本次各维度分数 + 下次复测起会显示变化），不再摆空表或写"还没有数据"（这正是用户以为功能坏了的原因）；≥2 次时只比共同维度、显示差值、间隔 <7 天提示练习效应；无共同维度退回基线并说明原因；折线图 ≥3 次记录才出现。`#/trend` 保留为**重定向到 `#/report`**（`history.replaceState` 同步地址栏，书签/旧链接/右栏按钮都不断），侧栏两个入口合并为「报告与趋势」。
- **等待可感知（反馈4，对应课程表 A6）**：对话页与报告解读卡都有三阶段等待气泡（0s 正在检索知识库 → 3s 模型思考中 → 10s 较慢将自动改用离线模板），三点跳动动画 + `role="status"`/`aria-live`，`prefers-reduced-motion` 下停动；用户这一句先回显再挂气泡，消除"发出去了但屏幕没反应"的空窗；空态也渲染进 `.chat-list`，修掉**第一次提问最需要反馈时反而没有反馈**的缺陷。
- **说明文字收敛（反馈2）**：35 处说明改为 `hint()` 悬浮解释（`?` 圆点，`data-tip` + `title` + `aria-label` + `tabindex=0`，键盘可达），删除 23 条常驻长句，就地精简 13 条，9 条产品口径收进说明页；全站 `lead` 8→3、`disclaimer` 5→3。新增 `scripts/test_copy_discipline.js`（6 项）做**反向**门禁：知情同意三句 + 两个必勾项、高风险/中风险提示、回退原因、等待阶段文案、做题指令必须始终可见，`tasks/**`、`games/**` 禁用 `hint()`，防止后来者为了"精简"把合规文案藏进浮框。
- **课程项目标注（反馈2）**：顶栏常驻「课程项目」pill（悬浮说明非商业、不收费、数据仅用于课程测试），侧栏页脚改为三行含「课程作业演示版 · 非商业产品」，说明页新增「关于这个项目」小节（课程交付用途、不收集邮箱因此无法自助找回密码、题库仍在迭代、发现分数不对请反馈）。
- **校验真实原因透传**：`_validate_node` 返回第一个 hard issue 的真实 code（`too_long`/`banned_word`/`unsourced_number`/`score_misattributed`/`mechanism_speculation`/`empty`）而非硬编码 `invalid`；前端 `LLM_FALLBACK_REASON` 按 code 出中文，界面不再出现任何后端术语（原「已回退模板：模型输出未通过校验」→「离线回答（已改用模板）：模型回答过长，已改用更稳的说法」等）。
- **`chat_explain` 字数 200 → 360**：200 字让中文一句有用的回答必然违规 → 频繁回退。提示词改为引用同一常量（`EXPLAIN_MAX_CHARS`），并加"第一句先直接回答、不要把指标重列一遍"；兜底改为按 intent 出题（问"明天测什么"给建议 + 复测间隔，不再 dump 指标）。
- **寒暄不再抢占意图**：`classify` 抽出为纯函数模块；GREETING 从硬路由降为兜底，`你好，我的认知怎么样` → summary、`你好，我想提分` → clarify；无测评结果时寒暄改口为"先完成一次测评"，不再引导用户问一个答不出来的问题。
- **可访问性（对应课程表 A9）**：内容文字不再用 `--dim`（≈2.9:1）—— `.tiny`/`.disclaimer`/`.sidefoot`/`.dim-badge`/未测行统一改 `--muted`（≈4.8:1）；记忆条目改为"文字行 + 操作行"两块，长文本换行不再压住按钮，触控区 ≥44px。

### 测试

- 后端 104 → **259 项**（新增 `test_derived_numbers.py` 63 项、`test_agent_output_contract.py` 44 项、`test_memory_sediment.py` 18 项、建议抽取与机制规则若干）；四条红线（未知数字仍拦、跨维度仍拦、评级仍拦、不许放宽 max_chars/require_*）各有专门测试钉住，**没有放松任何既有断言**。
- 前端 148 → **155 项**（`test_copy_discipline.js` 6 项新套件、app-shell 17→18、report/trend 5→12）。
- Playwright e2e 8 → **11 项**：新增「报告与趋势合一：第一次是基线，第二次出差值，旧入口重定向」「解读等待三阶段气泡且回退文案说人话」「悬浮解释键盘可达（Tab 到 `.hint` 后 `::after` 真的画出浮框）」「intake 三句知情同意不依赖 hover 就可见」；360px 无横向溢出的遍历页面从 5 个扩到 11 个。
- 部署冒烟 19 → **22 项**：新增「`settings/ai/test` 必须成功」「配了 Key 时解读必须 `source=llm`」「标准档 nc/ir/ni 不得为 null」。

## [0.3.3] - 2026-11-20 — 接通真实模型后的三处修正

用户配好 `.env.local` 后 AI 才第一次真的跑起来，随即暴露三个只有真模型才能发现的问题。

### 新增

- **模型过载韧性**（`app/llm.py`）：同一模型指数退避重试（`MM_LLM_RETRIES` / `MM_LLM_RETRY_BACKOFF_S`），仍失败按 `MM_LLM_MODEL_FALLBACKS` 顺序降级，全链失败才回退模板；`POST /settings/ai/test` 返回实际应答模型与 `tried` 列表。实测智谱 `glm-4.7-flash` 高峰返回 `HTTP 429 / code 1305 该模型当前访问量过大`，而 `glm-4-flash-250414`、`glm-4-air-250414` 秒回 —— 默认模型因此改为前者，4.7-flash 移到备用链末位。
- **网关自适应参数**：智谱系（`open.bigmodel.cn` / zhipu）自动发送 `thinking:{type:"disabled"}`，否则思考段会吃掉 `max_tokens` 预算并污染正文；`glm-z1-flash` 会把 `<think>` 写进 `content`，不列入可用模型。可用 `MM_LLM_EXTRA_PARAMS`（JSON）覆盖。
- **参考分归属校验**（`app/agent`，红线级）：真模型实测会把言语理解的 `5/50` 写进"为什么联想记忆低"的回答（真实 am 是命中 4、虚报 3、得分 26）。旧的 `unsourced_number` 只查"数字在不在 facts 里"，放行这种张冠李戴。现在 `dimension_score_owners()` 建立"分数 → 所属维度"表，句子点名了某维度却使用只属于别的维度的参考分 → **hard 失败并回退模板**。规则刻意做窄（只查参考分、不话题量类数字；句子没点名维度不判；两维共享同分都合法），实测三次 0 次串维度。提示词同步加入"每个数字只属于它自己那个维度，拿不准就不写"。
- **边界声明自动补写**：模型漏写"不能说明什么"时不再只是打 soft 标记，而是在回答末尾补写固定声明并从问题列表移除；其余 soft 仍上报。
- `scripts/dev_serve.py restart`；`start` 通过 `.env.local` 的 mtime+size 指纹识别"配置比进程新"并自动重启（此前正是它导致"Key 填了但 `ai.enabled` 仍 false"）；启动行直接打印 `AI：真实模型已生效 · model=…`。
- 冒烟检查新增 2 项：`settings/ai/test` 成功、`ai.enabled=true` 时解读必须真的来自模型（`source=llm`）；共 22 项。

### 修复

- 后端固定文案残留"本机"：趋势空态（`templates.py`、`agent.FIXED_REPLY[TREND_NO_DATA]`）改为"这个账号还没有两次可比的测评"。
- `render.yaml` 默认模型与备用链、`deploy-render.md` §2/§4 同步新参数与 1305 实测结论。

### 测试

- `tests/backend/test_agent_workflow.py` 新增 5 项：归属表构建、串维度必须 hard 失败、保守面（无维度名/共享分/题量数字不误判）、图级回退、固定话术内容。后端由 100 → **104 项**。

## [0.3.2] - 2026-11-20 — 人工测试反馈第 1 轮

### 变更

- **密码规则下调到 8 位**（原 10 位）：`app/auth.py`、`src/auth.js`、注册/改密页文案与占位符同步；新增边界用例锁死（8 位放行、7 位拒绝），文档 F-01 / NFR-SEC-02 / ADR-0003 同步。
- **测评前置两页合并重排**（反馈：年龄与知情同意被问了两遍）：
  - 页 A `#/intake`「先认识你一下」= 年龄 + 最高学历 + 知情同意勾选，**每账号一次**；
  - 页 B `#/prep`「今天的状态」= 昨晚睡眠 + 当前疲劳，**每次测评都填**；
  - 删除 `pages/consent.js` 与 `#/consent` 路由；`pickTier` 按资料是否齐全自动决定进 A 还是 B，路由闸门禁止未填资料直接进 B。
- **"只填一次"改为账号级**：`app_state.profile`（JSONB，迁移 `0005_profile`）保存 age/edu/consentVersion/consentedAt；原来存 localStorage，换浏览器/无痕窗口就会重新问。睡眠与疲劳**不进档案**，只留本次会话内存。
- **字段白名单**：`clean_profile` 只接受 age(10–100)、edu(固定选项)、consentVersion(≤24)、consentedAt；自由文本（备注、昵称、手机号）一律丢弃，不让这一列变成藏个人信息的地方；无效值忽略而非覆盖已有好数据；不带 profile 的旧快照不会抹掉已存资料。
- **控件与布局**（反馈：界面偏左、年龄上下箭头太小、滑块两端拉不到边）：
  - 新增 `body.setup` 布局用于这两页：收掉右侧快捷栏、主区居中窄列（原来卡片 560px 贴 604px 主栏左边缘）；
  - 年龄改为大号步进器 `stepper`（两个 44px 按钮 + 居中数字输入，隐藏原生 spin button）；
  - 疲劳 1–5 改为分段单选 `segmented`（44px 触控、无 range thumb 半宽造成的两端缝隙）；
  - 修正知情同意页写死的"标准档 · 4 项 · 约 13 分钟"（早就是 8 项，现按 `tier.tasks.length` 动态取）。

### 修复

- **服务端计分与前端引擎不一致（严重）**：Python 端口停留在旧口径 —— 不接收档位、题量写死 nc 20 / ir 15 / ni 20，而标准档实际下发 10 / 8 / 8 题，导致 **nc/ir/ni 的服务端分数恒为 null**（全对也是 null）；vc 缺四选一猜测校正、sv 缺加权正确率、ps 缺编码/分类双段、vf 缺秒数折算与 ASR 不可用判定、am 缺 PAL 口径。报告页显示的是前端分，而趋势、记忆摘要、对话 facts 读的是服务端分 —— 两边会各说各话。
  现在 `score_session(results, level)` 按 `LEVEL_SPEC` 取分母，公式与 `src/scoring/formulas.js` 逐条对齐，版本升到 **`scoring-v3.2`**；`POST /assessments` 传入 `mode`。新增**跨引擎一致性测试**（`test_matches_the_js_engine`，用 node 跑前端引擎对 4 组 fixture 逐维比对），金标准用例改为与 JS 侧同一组数字（vc 8/8→100、5/8→50、3/8→17、0→0；猜测校正后不再是 67/33）。
- `Number('') === 0` 导致**空的年龄输入被静默当成 10 岁**、必填校验永不触发：`clampNumber` 现在把空串/空白归到 fallback（`null`），页面才会在空值时提示必填。
- `store.update()` 是就地修改语义，`profile.saveProfile` 原先写成返回新对象 → 资料永远不落库；已改为写 draft，并新增回归用例（`test_app_shell.js`）钉住这条语义。
- `dev_serve.py` 分离进程拒绝 `--reload`：uvicorn 的 reloader 用 `CTRL_C_EVENT` 重启子进程，无控制台时抛 `WinError 6`，留下一个**跑旧代码的 worker**（实测新加的 profile 列被旧模型静默丢掉）。

### 新增

- `scripts/dev_serve.py`：本地站点的 `start / stop / status / url / logs`，进程脱离作业树，人工测试期间一直在线；支持从 gitignore 内的 `.env.local` 读取 `MM_LLM_*`。
- 测试：后端 `test_account_profile_roundtrip_is_whitelisted`；前端「前置两页分工」「控件：步进器数值收敛」两组用例；E2E 主链路改走 A→B 两页。

## [0.3.1] - 2026-11-20 — 清理桌面时代遗留，文档与实现对齐

### 删除

- 桌面入口与运行时：`MindMeter.cmd`、`MindMeter.vbs`、`code/desktop/`（launcher）、`docs/software/local-runtime.md`。
- 前端浏览器直连模型的 legacy：`src/llm/client.js`、`src/llm/degrade.js`、`src/agent/{run,classify,retrieve,validate}.js`、`src/eval/agent-cases.json`（评测集移到 `tests/ai_eval/agent-cases.json`）。
- 只测上述 legacy 的历史脚本：`scripts/test_storage.js`、`test_llm_client.js`、`test_agent_run.js`、`test_eval.js`、`test_agent.js`（后者测的是前端 classify/validate/fixedReply；其独有的「危机话术必须含 12356 与 120」断言已迁到 `tests/backend/test_agent_workflow.py`）。`npm run check` 因此从 12 套 154 项变为 **11 套 138 项**。
- 后端与前端里的桌面兼容分支：`security.py` 的 `LocalGuardMiddleware` 别名与 `enforce_local_request` 垫片、`config.py` 的 `MM_API_TOKEN`/`MM_PG_*` 残留字段、`api.js` 的 pywebview 桥与 `X-MM-Token` 头。

### 新增

- `scripts/check_frontend_dead_code.py`：从 `src/app.js` 做静态 import 可达性分析，报告不可达模块（防止 legacy 回流）。
- `scripts/e2e_server.py --db-only` / `--stop`：只要一个一次性 pgvector 库（打印 `MM_TEST_DATABASE_URL`）或把它停掉，不必起服务。
- [docs/software/local-development.md](docs/software/local-development.md)：本地三种起法、按改动类型的测试矩阵、LLM 联调（未配 Key / 已配 Key 两种状态）、手工回归清单、与 Render 的差异。

### 变更

- 知识库唯一来源重新确认：`src/kb/chunks.js`（人工编辑）→ `node scripts/export_kb_seed.mjs` → `app/rag/kb_seed.json`（迁移种子）；`kb-limit-04` 的标签与文案在两边一致。
- `scripts/setup.ps1` 改为 Web 开发设置（不再提示双击入口）。
- 需求文档与实现对齐：功能规范 §5.1（F-01～F-06 改为用户名+密码/Cookie 会话/即时注销）、§七 API 表按实际接口重写、§八 数据模型补 `users/auth_sessions/app_state` 与复合主键说明、§九 BR-09/BR-10 改写并新增 BR-13（按 `user_id` 隔离）；非功能规范 NFR-SEC-02/03/04/05/11 与 NFR-PRIV-02～07 改为 Cookie 会话、PBKDF2、站点凭证口径；两者均加 v3.1 变更记录行。
- `docs/adr/0001` 标注「部分被 ADR-0003 取代」，`architecture.md`/`logging.md`/`migration-report.md`/`m1_scope.md` 的桌面口径改为历史标注，链接改指 `local-development.md`。
- `scripts/check_docs.py` 必需清单同步（新增部署/开发文档、账号测试、冒烟与死代码检查脚本；移除已删除文件与 `code/desktop` 目录）。
- 版本号统一升到 0.3.1（`package.json`、`code/backend/pyproject.toml`、`app/config.py`）。

## [0.3.0] - 2026-11-19 — Web 托管版（账号 + Render）

架构从“pywebview 桌面单用户”切换为“同源 Web 多用户”，部署目标 Render。
决策与理由见 [ADR-0003](docs/adr/0003-web-accounts-and-hosted-deployment.md)，操作手册见 [部署指南](docs/software/deploy-railway.md)。

### 新增

- **账号体系**：用户名 + 密码注册/登录/登出；PBKDF2-HMAC-SHA256（240 000 轮、随机盐）；未知用户名也走一次散列以对齐响应时间；`/auth/register|login|logout|session|me|password|account`。
- **服务端会话**：`HttpOnly + SameSite=Lax + Secure(auto)` Cookie，数据库只存 `sha256(token)`；30 天滑动续期；登出/改密码/注销即撤销；登录按 `IP+用户名`、注册按 `IP` 限流（429）。
- **多租户数据模型**：`users` / `auth_sessions` 两张新表；`app_state`、`assessments`、`assessment_tasks/scores`、`memory_*`、`chat_messages` 全部改为以 `user_id` 打头的复合主键；`kb_chunks` 保持全站共享只读；`ai_runs` / `audit_log` 带 `user_id`；客户端 id（`s_xxx`、`kb-plan-01`）只在账号内唯一。
- **注销与清除**：`DELETE /auth/account`（需当前密码，`ON DELETE CASCADE` 级联删全部数据）；`DELETE /data` 只清本账号。
- **站点统一 LLM**：`MM_LLM_BASE_URL` / `MM_LLM_MODEL` / `MM_LLM_API_KEY`；`GET /settings/ai` 只读（`managedBy=site`、`readOnly=true`、掩码提示），`PUT /settings/ai` 与 `DELETE /settings/ai/key` 一律 403 `ai_managed_by_site`。
- **前端登录体验**：`#/login`、`#/register` 两页（18+ 与边界勾选、错误码人话文案）；路由闸门（未登录只放行认证页，侧栏/右栏/顶部控件随之隐藏）；401 全局广播自动回登录页；设置页新增账号卡（用户名、注册/上次登录时间、退出、改密码、注销）。
- **部署物料**：`render.yaml`（Blueprint：Web Free + PostgreSQL 17 Free + `vector` 扩展 + `preDeployCommand` 迁移 + `/api/v1/health/live` 探活）、`requirements.txt`（去掉 pywebview/keyring/fastembed）、`.python-version`、`scripts/smoke_web_deploy.py`（19 项部署后冒烟检查）。
- **传输守卫**：`SecurityMiddleware` 保留安全头与 CSP，写请求要求同源 Origin + `application/json`（配合 `SameSite=Lax` 构成 CSRF 防线）。
- **健康分层**：`/health/live`（不碰 DB，供平台探活）与 `/health`（DB/迁移号/pgvector/RAG/AI 配置状态/账号数，公开、无用户数据）。
- **测试**：`tests/backend/test_auth_api.py`（口令/会话/限流/改密码撤销/注销复用）、`test_tenancy.py`（跨账号读写、同 id 不冲突、越权 404、每账号 50 次上限）；`scripts/test_auth.js`（10 项前端规则与传输断言）；E2E 改为真实注册/登录流；`scripts/e2e_server.py` 自建便携 PostgreSQL（trust、仅回环），不再依赖桌面 launcher。

### 变更

- `config.py`：`MM_DATA_DIR` 在 Render 上落到 `/tmp/mindmeter`；新增会话、限流、LLM、`MM_ALLOW_REGISTRATION`、`MM_EXPOSE_LOGS` 等开关。
- `db.py`：连接串归一（`postgres://`、`postgresql://` → `postgresql+psycopg://`）、小连接池 + `pool_recycle=280`（免费实例会关闭空闲连接）。
- `logging_setup.py`：托管环境同时输出到 stdout（Render 日志页可见），文件目录不可写时不再让进程启动失败。
- `data.py`：导入不再依赖 `pg_dump`（文件系统临时），改为提示“先导出留档 + 平台每日备份”；`/logs` 默认关闭。
- 口径统一：界面与知识库里“本机运行 / 数据不出这台电脑”改为“站点托管 · 按账号隔离”，`kb-limit-04` 同步改写（迁移 `0004_hosted_copy`）。
- Alembic：新增 `0004_hosted_copy`；在旧桌面库（无 `users` 表）上会明确报错并提示需要全新数据库。

### 删除

- `keyring_store.py`、`testing_keyring.py`、`ai_settings` 表与 BYOK 输入框（Key 不再由用户提供）。
- `LocalGuardMiddleware` 的 loopback/`X-MM-Token`/随机端口前提；`api.js` 不再依赖 pywebview 桥（桥仍是兼容分支）。
- 旧 `logs` 端点的默认暴露、`POST /import` 的自动 `pg_dump` 备份。
- 桌面版作为主入口的地位：`MindMeter.cmd` / `.vbs` / `code/desktop/` 保留但不再维护。

### 已知限制

- 没有邮件验证与自助找回密码（不收集邮箱，是刻意取舍；登录页与设置页已写明）。
- 限流与会话状态在单实例内存+数据库里，未做多实例共享会话缓存。
- 免费实例冷启动约 1 分钟、文件系统临时、免费 Postgres 30 天后过期；`*.onrender.com` 在中国大陆可达性不稳，文档给出换 region 与升级 `starter` 的做法。
- 向量检索在 Web 依赖中默认关闭（`MM_RAG_MODE=keyword`），语义召回质量低于带 embedding 的桌面版。

## [0.2.0] - 2026-11-14 — 桌面本地架构

架构从“浏览器 UI + localStorage + 浏览器直连 LLM”迁移为
“pywebview + FastAPI + 便携 PostgreSQL + Alembic + pgvector + LangGraph + keyring”。

### 新增

- **桌面 launcher**：单实例锁、随机端口、首次 initdb、二次复用、**pg_dump 后迁移**、Job Object 退出清理；双击 `MindMeter.cmd` / `MindMeter.vbs`。
- **FastAPI 本地后端**：`/api/v1/*` 全部要求 `X-MM-Token`；只监听 `127.0.0.1`；拒绝非 loopback Host/跨源 Origin；CSP。
- **PostgreSQL 17.12 + pgvector 0.8.6**：12 张表；Alembic `0001_initial` + `0002_seed_kb`；30 条知识块。
- **服务端计分**：`scoring-v3.1` Python 唯一权威；22 项 JS 金标准平移到 pytest。
- **pgvector RAG**：`BAAI/bge-small-zh-v1.5`（512 维）+ BM25 混合；模型不可用时 `keyword` 降级。
- **LangGraph Agent**：classify → retrieve → generate → validate；无 Key/失败回退模板。
- **Keyring only**：LLM Key 只在 Windows Credential Manager；`ai_settings` 只存 `key_ref`/`key_hint`。
- **旧数据导入**：设置页选择旧版导出 JSON；导入前自动 `pg_dump`；忽略 `apiKey`。
- **测试**：`npm run check`、`pytest tests/backend`、`npm run test:e2e`（真实 PostgreSQL）。
- **Agent 安全与可信度**：移除跨轮状态泄漏；风险分级（crisis/boundary/high-domain/support）；手机号/身份证/邮箱拦截与脱敏；引用改为可展开来源卡片；无依据不再伪造引用；等待状态与慢响应提示；新增“我的认知怎么样”总览意图与问候意图；总览与报告 AI 解读改为 facts + 知识库 + 具体建议并带来源；清理 NO_PROXY 中的 `[::1]` 以避免 httpx 0.28 在模型调用前崩溃。

### 变更

- 前端 `storage.js` / `store.js` 改为内存缓存 + 本地 API；页面仍同步读取。
- 报告/对话/设置不再直连模型；`llm/client.js` 与 `agent/run.js` 成为未引用的 legacy。
- `tests/backend/test_openapi_contract.py` 的 auth/JWT 路径替换为本地无账号 API。
- `m1_scope.md` 的“无后端”范围被 ADR-0001 取代。

### 删除

- localStorage 业务数据持久化（Key 尤其）。
- 浏览器直连 LLM 的生产路径。
- SQLite 过渡方案（未引入）。

## [未发布]

### 新增

- **趋势联动（Agent P0）**：对话新增 `trend` 与 `self_blame` 意图；趋势页「让 Agent 解释这两次的变化」入口带预置提问；`/chat` 的 facts 携带两次对比数据（共同维度、差值、间隔、练习效应标记）；趋势解释有专用场景模板兜底。
- **场景策略统一**：`agent/policies.py` 集中每个场景的长度上限、引用/边界声明要求与附加禁词；公共 prompt 新增「禁止换算为 MoCA 等量表分值」「禁止特质归因（含褒义）」两条纪律；`BANNED_WORDS` 增补减退/受损/退化。
- **可观测**：`/chat` 每次回答写入 `AIRun`（意图、模型、延迟、降级、校验明细），与报告解读卡同表可查。
- **测试**：后端新增 `test_agent_workflow` / `test_trend_assembly` / `test_agent_trend_api`；文档新增 [ADR-0002 非临床定位与 Agent 语言契约](docs/adr/0002-agent-positioning-language-contract.md) 与 [Agent P0 改造包设计](docs/software/agent-trend-workflow.md)。

### 变更

- **对话页布局**：改为标准对话式三段结构（标题栏 / 单一滚动消息区 / 底部输入框），修复页面被重复渲染导致的「两个标题、输入框跑到消息区上面」；返回报告、我的记忆、清空对话收进标题栏，配置未就绪提示收成细条。
- **统一 AI 出口**：报告解读卡 `POST /reports/{id}/explain` 收编进 LangGraph 主图（scene=report），模型输出不再绕过校验直达用户；响应协议不变。
- **校验策略分档**：缺引用/缺边界声明改为软记录（不再一票否决整段回答）；facts 数字的确定性派生（同维度加差、整数百分比、毫秒→秒）进入白名单；检索为空但 facts 可答时不再误回退「我不猜」。
- **对话时序修复**：`build_messages` 历史消息不再排在当前问题之后；对话路由不再持有无效 checkpoint（去掉 MemorySaver）。

### 已知缺口

- **D-03**：Agent 检索为空时的回复是「我不猜」，而 M1 验收要求字面出现「不知道」。
  语义等价、字面不符，属 L-05 文案，待 owner 决定后再改（见[测试与评测计划](docs/software/test-plan.md)第九节）。
- **知识库待核源**：30 条 chunk 全部为 `review.status = draft`，人工核验来源后才进入检索索引。
  核对表见[知识库来源核验](docs/software/kb-source-review.md)。
- **Agent 四维评分未做**：30 条用例的行为分支已自动化（30/30），
  但「准确/有依据/有用/无越界」四项需接入真实模型后人工打分，尚无评分记录。

## [0.1.0] - 2026-11-07 — M1 纵向切片

打开即用 → 标准 4 项 → 本地计分 → 八维报告（4 测 4 未测）→ 用户自备 LLM API → Agent 解释 → 本地记忆 → 复测趋势。
纯本地运行，无远端账号、无服务端存储。

### 新增

- **静态 App 壳**（L-01）：首页、同意、档位、任务、报告五类路由，无构建、无后端，原生 ES Module。
- **本地存储**（L-03）：`sessions / draft / settings / memory` 四类数据，支持刷新恢复、导出 JSON、一键清除；导出不含 Key。
- **BYOK 设置**（L-04）：用户自填 endpoint / model / key，含 CORS 提示、超时与降级；Key 不写日志、不进导出。
- **本地计分 `scoring-v3.1`**（L-02）：八维公式，M1 落地 vc / ps / sv / am 四维；
  缺失记 `null` 而非 0；**不产生总分**；阈值集中在 `scoring/config.js`。
- **报告与趋势**（L-08）：八轴雷达图、4 项分数 + 4 项「未测」、复测只比共同维度、7 天提示。
- **本地 Agent**（L-05）：`输入 → 分类 → 检索 → 生成 → 校验 → 输出` 状态机；
  五类意图（解释/反问/无关/越界/危机），只有「解释」调模型，其余走固定话术。
- **本地记忆**（L-07）：画像、摘要、建议记录，上限 20 条，删除后不再被引用。
- **本地知识库**（L-06）：30 条知识块 + BM25 / 中文 bigram 检索（top3，零依赖），只索引已审条目。
- **十二屏线框**（P-08）：360×780，含空状态，用于 UI 对齐。
- **关键路径内存日志**：`storage` / `store` / `llm` / `agent` / `app` 在失败点与关键流程写入环形缓冲 `__MM_LOG__`（上限 200 条）。
  刻意**不写 console**——项目有一条硬性测试禁止前端任何 `console.*`，防止 Key 意外落日志；排查时在控制台执行 `__MM_LOG__` 即可。
- **错误兜底（内联，不新增文件）**：路由渲染包 `try/catch`，失败时用内联错误块替换整页；
  注册 `window.error` 与 `unhandledrejection`；计分失败不阻断交卷，模型失败回退模板。
- **页面级兜底**：任务草稿损坏时自动丢弃并重开一次；报告页计分失败退回「全部未测」；
  趋势页读不到历史按「还没有记录」处理；导出/清除失败给出明确提示，不再静默无反应。

### 变更

- **复杂度治理**：接入 SonarJS 规则，认知复杂度阈值统一，测试套件单独放宽；
  全仓 lint 问题从 29 处降到 0。
- **文档格式统一**：全部 Markdown 经 Prettier 格式化，契约测试导入告警修复。
- **CI 收紧**：`lint`、`format:check`、12 个测试套件串入 `npm test`，PR 与 `develop` 推送均触发。

### 修复

- **报告未接真实计分**：`report.js` 一度只显示原始指标，改为读 `scoreSession()`，并用 `scoring/index.js` 替换临时的 `scoring/local.js`。
- **CI 格式检查失败**：app shell 测试未格式化导致 pipeline 红，已修并纳入 `npm test`。
- **Agent 意图误判**（评测发现）：
  - 「算不算有病」被判成「指代不明」→ `BOUNDARY_WORDS` 收敛为「有病」，覆盖两种问法；
  - 「未测是什么意思」被判成「指代不明」→ `DOMAIN_WORDS` 增加「未测」，避免短句走 too-short 规则。
- **计分舍入偏差**：`0.7×0.75 + 0.3×0.6` 手算 70.5，浮点算成 70.4999 后向下取整，改用 `+1e-9` 容差。
- **页面抛错即白屏**：页面渲染没有兜底，任一页面抛错整页空白。改为在 `app.js` 里包 `try/catch`，失败时渲染内联错误块。
- **计分失败会阻断交卷**：`finishTask` 里裸调 `scoreSession()`，一旦抛错整次测评丢失。改为 `safeScores()` 兜底，分数留空、作答照常保存。
- **计分实现未统一**：`app.js` 仍引用临时的 `scoring/local.js`，与 `report.js` 的实现不一致，已统一到 `scoring/index.js`。

### 文档

- **P-06 知识库设计**：六类分类、chunk schema（11 字段）、30 条计划、13 条来源候选、hit@3 口径。
- **P-07 测试与评测计划**：7 层测试分工、30 条 Agent 用例、四维评分锚点、入口与出口标准。
- **算法文档升到 v4.1**：公式分母按 M1 实际题量重定（vc 6 题、ps 8→24/45 秒、sv 8 题 + RT 1500/4000、am 8/8）。
- **来源核验**：9 篇论文按 Crossref DOI 核对、1 份政府文件按文号核对；
  核不实的 9 条候选（含 Carroll 1993、Green & Swets 1966、AERA Standards 2014、Schneider & McGrew 2018、三本中文教材）**一条未采用**。

### 测试

12 个套件、168 项检查，全部纳入 `npm test`：

| 套件 | 项数 | 覆盖 |
| --- | --- | --- |
| `test_prototype.js` | 7 | 原型 smoke、页面存在性 |
| `test_app_shell.js` | 14 | 路由、状态、360px、任务纯逻辑、异常兜底 |
| `test_storage.js` | 8 | 刷新恢复、导出、清除 |
| `test_llm_client.js` | 16 | BYOK、超时、降级、Key 不落日志 |
| `test_report_trend.js` | 11 | 4+4 未测、无总分、共同维度 |
| `test_scoring.js` | 22 | 金标准、边界、缺失、性能 |
| `test_agent.js` | 16 | 分类、固定话术、校验器 |
| `test_agent_run.js` | 6 | 状态机、兜底链路 |
| `test_memory.js` | 11 | 上限、删除后不引用 |
| `test_kb.js` | 13 | 契约、禁用词、hit@3、性能 |
| `test_units.js` | 13 | random / router / ui / sv 单元 |
| `test_eval.js` | 30 | Agent 30 条行为分支 |

另：`check_docs.py`（结构/链接/重复）、`check_secrets.py`（Key 扫描）在 CI 中独立运行。

## [0.0.2] - 2026-10-24 — 文档与设计冻结

### 新增

- 用户故事、Agent 设计、功能与非功能需求规范。
- 认知测量框架调研、维度与分档调研、Agent 平台调研。
- 原型说明与 AI 接入位契约。

### 变更

- **P-01 冻结 M1 范围**：改为纯本地 + 用户自备 LLM API；
  删除账号、服务端计分、Postgres/pgvector、服务端 LangGraph；
  M1 范围收敛为 L-01～L-09 九张卡。
- 四维口径与 `rengzhi.md` 的差异完成评审并归档。

## [0.0.1] - 2026-10-17 — 仓库初始化

### 新增

- 仓库骨架与初始文档结构。

## 版本说明

- 本项目**没有发布 tag**，上面的版本号按当前 `package.json` 的 `0.1.0` 回溯标注，
  用于让读者区分阶段，**不代表当时打过的发布**。
- 日期以 PR 合并日期为准；同一天合并的 PR 归入同一版本。
- 0.1.0 之前的提交按主题归并，不逐条罗列。

## 维护约定

1. 每个 PR 合并后，在 `[未发布]` 下追加一行，写清**用户能感知到什么变化**；
   不写「修改了 xx 文件」这类实现细节。
2. 发版时把 `[未发布]` 的内容移到新的版本标题下，并补日期。
3. 分类沿用 Keep a Changelog：新增 / 变更 / 废弃 / 移除 / 修复 / 安全。
4. 破坏性变更必须单独标注，并写明迁移方式。
