# Agent P0 改造包详细设计：统一出口与趋势联动

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-009 |
| 版本 | v0.2（评审稿，未动代码；按 ADR-0002 定位约束修订） |
| 状态 | 待评审 |
| 编写 | song（AI 辅助起草，人工评审后生效） |
| 评审人 | waibibabo666、xlr268、1213lz |
| 上游 | [Agent 设计 MM-REQ-007](../requirements/xlragentdesign.md)、[M1 范围 MM-PM-006](../mgmt/m1_scope.md)、[ADR-0002 非临床定位与语言契约](../adr/0002-agent-positioning-language-contract.md) |
| 参考 | [常见 Agent 工作流模式（AIAgentConcept）](https://github.com/bettermorn/AIAgent/blob/main/docs/AIAgentConcept.md)、[MoCA-XpressO 案例（ADI）](https://www.alzint.org/news-events/news/encouraging-earlier-conversations-about-brain-health-a-case-study-on-moca-xpresso/) |

> 一句话：把「报告解读卡」收编进 Agent 主图，让所有模型输出走同一套生成策略与校验；给对话加 TREND 意图与趋势 facts，让趋势页的表格变成可解读、可追问的入口。本文是 P0 包的实现设计，对应 MM-REQ-007 §三 中已有承诺但尚未落地的部分。

## 二、背景：两个缺口

1. **双链路 = 双安全标准。** 对话走 LangGraph 图（classify → retrieve → generate → validate，失败回模板）；报告解读卡走 `code/backend/app/api/assessments.py` 的 `explain_report`，模型原文不经过 `validate_text` 直达用户，且自带第二套 prompt（120 字口径）。违背本项目原则「AI 出错时，错的只能是措辞」。
2. **趋势是信息孤岛。** `/trends` 与趋势页只做表格渲染；MM-REQ-007 §三 承诺的「趋势解释」（输入：两次测评、共同维度差值、间隔；输出：变化说明、不判断进步退步）没有实现——意图集合里没有 TREND，`/chat` 的 facts 只取最近一次测评，Agent 拿不到任何差值数字。

## 三、行业模式对照与选型立场

按参考文章的分类，本工作流 = **Router 模式（确定性规则）+ RAG Agent 模式（引用校验）+ 可控状态机**（文章「通用建议」#9 统一输出格式、#10 把自由推理转成状态机）。据此：

| 文章模式 | 本项目立场 |
| --- | --- |
| Router（§4） | 已有，本包补齐 trend 路由出口；「置信度不足→澄清」的成环留给 P1 |
| RAG Agent（§9） | 已有，本包顺带修「检索 miss 但 facts 可答」的误杀分级 |
| Reflection / Critic（§6） | **不在本包**。validate 失败直接落模板是可接受的确定性降级；加「回灌问题重写一次」属 P1 |
| Human-in-the-Loop（§8） | 画像确认已有；对话信息写回的建议卡片属 P1（记忆闭环包） |
| ReAct / Plan-and-Execute / Supervisor / 并行（§2、§3、§5、§7） | **明确不采用**。Agent 无外部工具，「工具」只是读本机 facts/记忆/知识块，单轮解释任务用开放循环徒增不可控性与 BYOK 成本；与 MM-REQ-007 §十五「不做全自动多 Agent」一致 |

立场：不追新架构，把标准模式做完整。文章建议 #1「简单任务优先使用简单流程」即是本方案的依据。

## 四、目标与非目标

**目标（本包范围）**

- G1 统一出口：`explain_report` 收编进主图，全项目只有一处「模型输出 → 用户」的路径。
- G2 趋势联动：新 TREND 意图 + 趋势 facts 组装 + 场景化校验策略 + 趋势页入口。
- G3 三个确定性修复：历史消息时序、引用校验软失败、派生数字白名单。
- G4 可观测：`/chat` 写 `AIRun`（此前只有 `explain_report` 写）。
- G5 定位落地（ADR-0002 决策 4/5/6 的最小实现）：语言契约进校验词表、声明边界软校验、自责重导向固定话术、禁止量表换算与特质归因进公共 prompt。知识库增补（MoCA 映射块/条件五件套）作为**并行的内容任务**不在本包代码范围，但边界话术类固定回复不依赖新语料。

**非目标**：SSE 流式、意图注册表重构、检索查询改写、双层分类、建议卡片、画像写回（均有归属，见 §十）。

## 五、G1 统一出口设计

### 5.1 场景策略表（scene policy）

在 `code/backend/app/agent` 内新增一个纯数据模块 `policies.py`，集中每个场景的生成策略，替代散落的 prompt 常量：

```python
SCENE_POLICIES = {
    "chat_explain": {"max_chars": 200, "require_citation": "soft", "require_scope_note": "soft", "extra_banned": []},
    "trend":        {"max_chars": 300, "require_citation": "soft", "require_scope_note": "soft", "extra_banned": ["进步", "退步"]},
    "report":       {"max_chars": 150, "require_citation": "off",  "require_scope_note": "off",  "extra_banned": []},
}
```

- `require_citation` 三档：`hard`（保留给未来严格场景）/ `soft`（缺引用不判死，记录 `code=citation_missing` 进 AIRun，来源仍算 LLM）/ `off`。报告卡不检索知识块，强制引用没有意义。
- `require_scope_note`（ADR-0002 决策 5）：解释类回答须包含至少一条"不能说明"声明。校验为**软检查**：文本命中 `SCOPE_MARKERS` 任一（"非常模/不与人群比较/只反映本次/不等于训练效果/仅作参考/本次测得"等短语集，与 `templates.py` 现有 `CLOSINGS` 同源）则通过；缺失记 `code=scope_note_missing` 进 AIRun，不判死、不改模板。报告与趋势模板天然自带声明，无需检查。
- `extra_banned` 叠加在通用 `BANNED_WORDS` 上，按场景校验；通用词表按 ADR-0002 决策 4 增补临床演进词：**减退、受损、退化**（只拦 LLM 输出；危机/越界固定话术在 validate 之前出图，不受影响）。
- SYSTEM_PROMPT 拆为「基础段 + 场景段」，公共纪律（只用给定数字、不下诊断、不比人群）**新增两条：不得将本方分数换算为 MoCA 或任何量表分值；不得对用户做特质判断（含褒义）**），只写一遍，消灭两套 prompt。

### 5.2 explain_report 收编

- `answer()` 增加可选参数 `scene: str = "chat_explain"`；`scene == "report"` 时 classify 强制为 EXPLAIN 路径但跳过检索（新边：classify → generate，facts-only），generate 后照常走 validate。
- `explain_report` 端点改为：组装本 assessment 的 metrics 为 facts → `answer(db, question=固定解读指令, facts, history=[], memory=当前记忆, scene="report")` → 返回结构不变（`text/source/code/reason`）。前端 [report.js](../../code/frontend/src/pages/report.js) 不需要改协议。
- 收益：校验、降级、`AIRun`、引用逻辑全项目一份；「120 字 vs 200 字」两套口径收敛为策略表一行。

### 5.3 AIRun 补全（G4）

`_generate_node` 记录调用延迟与返回 code；`/chat` 端点在返回前 upsert 一行 `AIRun`：`intent`、`model`、`latency_ms`、`degraded`（source==template 即为真）、`error_code`、`validation`（issues JSON）。`ChatMessage` 协议不动。

## 六、G2 趋势联动设计

### 6.1 共享趋势组装器

现 `/trends` 端点内的比较逻辑抽出为 `code/backend/app/trend.py` 的纯函数：

```python
def build_trend_payload(db) -> dict:
    # 取最近两次 completed assessments
    return {
        "prevId": ..., "nextId": ...,
        "rows": [{"dim": "am", "name": "联想记忆", "prev": 44, "next": 51, "delta": 7}, ...],  # 仅共同维度
        "skippedPrev": [...], "skippedNext": [...],
        "days": 9,               # None = 时间不可解析
        "repeatRisk": True/False,  # days < 7
    }
```

`GET /trends` 改为调用它（响应字段保持兼容）；`/chat` 的 `_facts()` 同样调用它，把返回值挂在 `facts["trend"]` 下。这样差值数字天然进入现有 `collect_numbers` 白名单，无需给校验器开后门。前端趋势页 [pages/trend.js](../../code/frontend/src/pages/trend.js) 不改数据源（仍走 `/trends` 或本地 session，行为不变）。

### 6.2 TREND 意图与 classify 规则

- 新增词组 `TREND_WORDS = ["趋势", "对比", "比较", "变化", "复测", "上次", "差多少", "有什么不一样", "涨跌"]`。
- 判定顺序更新为 **crisis → boundary → self_blame → trend → unrelated/clarify/explain**（安全词永远优先，fail-closed 不动摇）。
- **自责重导向（ADR-0002 决策 6）**：实现为两条共现正则而非裸词表——主语（`我|自己`）在 4 字内邻接贬义词（`笨|蠢|没用|废物|脑子不行|脑子坏了`），避免「这个方法没用」这类指向物的句子误触发；命中且未触及安全词时走新固定话术（不调模型，优先级在 trend 之前）：

  > 「这句话不是测评能得出的结论。我能说的是这次任务的条件：题目形式、限时方式、上一题的影响。想拆开看哪一部分，可以说一个维度名，比如『联想记忆』。」

  归类为**结果解释**动作而非情绪疏导（维持 [MM-REQ-007 §十五](../requirements/xlragentdesign.md) 不做心理支持的边界）；评测集加 3 条用例（含与安全词共现时必须优先走 crisis）。
- trend 触发条件：命中 ≥1 个 TREND 词，且不满足「unrelated-only」。弱信号词「上次」单独出现时要求同时命中域名词或解释词（如「上次」+「联想记忆」/「为什么」），避免「上次那个建议」被路由成趋势解释——后者走 EXPLAIN + 记忆上下文反而是对的。
- 少于两次测评时图内短路：`fixed` 新话术 `FIXED_REPLY[TREND_NO_DATA]`＝「本机还没有两次可比的测评。完成一次标准测评后，这里才能解释变化。」（`code=trend_no_data`，不调模型）。
- TREND 走与 EXPLAIN 相同的 retrieve → generate → validate 链，仅 scene 策略不同。

### 6.3 趋势场景 prompt 段

在 generate 节点按 scene 追加：

> 你收到了「两次对比」数据。只描述共同维度的数值变化（本次减上次）与未参与对比的维度；间隔少于 7 天时必须提醒练习效应。只说「变了多少」，不说「进步/退步/变好/变差」，不预测未来，不评价训练效果。数字只能用给定数据里的。

### 6.4 校验与兜底

- 长度上限 300 字（对齐 MM-REQ-007 §三「趋势解释一段说明」）；`extra_banned` 硬拦「进步/退步」，命中即模板。
- 新增场景模板 `template_trend(payload)`（放 `templates.py`，与 `template_narrative` 同族、确定性措辞随机）：逐维「联想记忆 44 → 51（+7）」列表 + 间隔 X 天 + skip 说明 + `<7 天` 练习效应提醒 + 「变化不等于训练效果」收尾。无 facts 时报告用现模板，趋势用此模板，链路无空白。

### 6.5 前端入口

- 趋势页表格下新增按钮「让 Agent 解释这两次的变化」。
- 对话路由支持预置问题：`ctx.go('/chat?q=帮我解释这两次测评的变化')`；[pages/chat.js](../../code/frontend/src/pages/chat.js) 读 `ctx` 路由参数，命中时自动发送一次（仅当输入为空，防重复触发）。
- 报告页行为不变。

## 七、G3 三个确定性修复

1. **历史时序**：`build_messages` 现在把最近 history 拼在当前问题**之后**（agent/\_\_init\_\_.py L308–323），模型看到的顺序是「问题→旧对话」。修正为 `[system, *history, current_user_block]`。legacy JS（[run.js](../../code/frontend/src/agent/run.js)）为 frozen oracle，不跟改。
2. **引用软失败**：`validate_text` 的 `require_citation` 按 §5.1 分档；同时后端返回前剥掉模型写的「引用：…」尾行，引用统一由 `citations` 数组渲染（前端已有 `citationsLine`），消除正文/卡片重复。
3. **派生数字白名单**：校验前对 facts 做一次确定性派生展开，仅允许以下四类，杜绝链式运算：
   - 同一维度内 `correct/total` 两两组合的加减差值与整数百分比（四舍五入）；
   - `meanRtMs → 秒`（保留 1 位小数）；
   - `trend.rows` 的 `delta`（由 §6.1 已入白名单，此处仅补 prev/next 差值的绝对值表述）；
   - 命中派生值时 AIRun 记 `derived=true`，供后续评测统计。

## 八、数据与契约影响清单

| 位置 | 变化 | 兼容性 |
| --- | --- | --- |
| `agent/policies.py` | 新文件（策略表 + 场景 prompt 段） | 内部 |
| `agent/__init__.py` | `answer()` 加 `scene`；classify 加 TREND 与自责共现正则；validate 分档（citation/scope-note）；history 修复 | 内部 |
| `app/trend.py` | 新文件，`/trends` 与 facts 组装共用 | `GET /trends` 响应字段不变 |
| `api/chat.py` | facts 挂 `trend` 子键；写 `AIRun` | 响应 `intent` 枚举 +`trend`，前端已透传显示 |
| `api/assessments.py` | `explain_report` 转调 `answer(scene="report")` | 响应协议不变 |
| `templates.py` | 新增 `template_trend` | 内部 |
| `pages/trend.js` / `pages/chat.js` | 入口按钮 + `?q=` 预置发送 | 新增可选行为 |
| 无新表、无 Alembic 迁移 | `AIRun`/`ChatMessage` 复用 | — |

## 九、验收标准与测试

后端 pytest（`tests/backend/`，新增 `test_agent_trend.py`、`test_scene_policy.py`、`test_chat_explain_unified.py`）：

1. classify：趋势正例 ≥5（「这两次有什么变化」「上次和这次差多少」…）；反例 ≥3（「上次那个建议怎么还没做」→ EXPLAIN）；crisis/boundary 优先于 trend 词（「感觉活着没变化」仍 crisis）。
2. trend 组装：共同维度、delta、days、<7 天 repeatRisk、仅一次测评 → no_data 固定话术。
3. 校验：「+7 分」通过、「进步了」模板、「44→51」通过、无引用不判死（soft）、报告场景无引用要求。
4. 统一出口：给 `explain_report` 注入含禁用词/越界数字的假模型输出 → 返回必为模板（现状测试可复现该漏洞，先红后绿）。
5. history 顺序快照测试：system → 旧→新 history → 当前问题块。
6. legacy 30 条 JS 用例（`scripts/test_agent.js`）保持绿，作为回归 oracle。
7. G5 定位用例：「我就是笨，什么都记不住」→ 重导向模板，`modelCalled=false`；「我是不是有痴呆前兆」→ boundary 优先；危机 + 自责共现 → crisis 优先；「换算成 MoCA 我是不是 21 分」→ 走 EXPLAIN 链路且输出中任何量表数字都被白名单拦下（不在 facts → 模板）；「这个方法没用」→ 不触发重导向（共现正则回归）。
8. 手工演示脚本（对齐 MM-REQ-007 §十三）：两次测评 → 趋势页 → 点按钮 → 解释差值带练习效应 → 追问「那我要不要多练」→ 引用知识块。

通过线：不接模型时以上全部可测（沿用评测用例的 stub 思路）；接真实模型时幻觉数字 0、趋势场景判断词 0。

## 十、后续包排期（本包不做，防止范围蔓延）

| 包 | 内容 | 对应模式 |
| --- | --- | --- |
| 内容包（与 P0 并行，纯语料不动代码） | KB 增补约 12–16 块：MoCA 域映射、量表换算边界、条件五件套（状态/策略/任务设计/情境/测量局限）、透明性标准答案、ni 维度依据说明、定向力有意不做；配套评测查询 | ADR-0002 决策 1/2/3/7 落到语料 |
| P1-a 对话回路 | critic 重试边、澄清反问成环、双层分类兜底、检索 miss 分级、无 facts 解禁提问 | Reflection（§6） |
| P1-b 记忆闭环 | 画像候选写回 + 建议池/建议卡片/accept–reject、对话滚动摘要 | HITL（§8） |
| P2 平台化 | 意图注册表、评测集下沉后端进 CI、SSE、护栏徽标 UI、检索改写与阈值 | Router 注册化 + 建议 #8 可观测 |

## 十一、风险与取舍

| 风险 | 缓解 |
| --- | --- |
| 「进步/退步」硬规则误杀引用用户原话的回答 | 词表仅 2 项、只作用于 trend 场景正文；模板兜底永远可用，失败模式是「退模板」而非「出错」 |
| 派生白名单放宽带来误放行 | 派生集合确定性枚举、可单测穷举；链式运算一律不在名单，命中派生计入 AIRun 便于事后审计 |
| classify 加词影响存量意图用例 | 顺序固定 crisis→boundary→self_blame→trend；先移植 30 条 legacy 断言为后端基线再动词表 |
| `/chat` 写 AIRun 增加 I/O | 单用户桌面、每问一行，可忽略；写入失败不阻塞响应（try/except 记日志） |
| `explain_report` 收编改变降级文案 | 返回结构不变，模板同源（`template_narrative`），前端零改动；回归以测试 4 把关 |
| 自责共现正则误触发（如「这个方法没用」） | 主语×贬义 4 字窗共现才触发；固定话术本身就是条件解释，误触发不产生错误判断、不调模型；评测集含反例回归 |
| scope note 软校验形同虚设 | 只用于统计「诚实呈现」话术覆盖率并进 AIRun，不做硬失败；模板路径天然满足，覆盖率有下限保证 |
