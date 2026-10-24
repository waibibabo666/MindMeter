# Agent 设计与功能说明（L2）

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-REQ-007 |
| 版本 | v3.0（L2） |
| 状态 | 目标设计；M1–M3 分阶段实现 |
| 编写 | xlr268 |
| 评审人 | waibibabo666、song、1213lz |
| 最后更新 | 2026-10-24 |
| 上游 | [功能需求](functional_spec.md)、[算法设计](../algorithm/algorithm.md)、[技术方案](../software/architecture.md) |
| 关联 | [用户故事](../research/user_stories.md)、[问题定义](problem_definition.md) |

> L2 的 Agent 是产品核心，不是“报告下面的一个解读卡片”。它要能解释、建议、追问、记住、看趋势；但**不做诊断、不做计划/打卡、不做情绪支持**。

## 二、一句话

**测评产生 facts，知识库提供依据，记忆提供连续性，LangGraph 负责可控编排，模型负责把话说人话。**

## 三、Agent 做四件事

| 场景 | 输入 | 输出 | 优先级 |
| --- | --- | --- | --- |
| 报告解读 | 当前 facts（八维分数、完成度、档位） | ≤200 字解读 + 2–3 条建议 | P0 |
| 追问 | 用户问题 + facts + 记忆 + 知识块 | ≤300 字回答，可反问一次 | P0 |
| 趋势解释 | 两次以上测评、共同维度差值、间隔 | 一段变化说明，不判断进步/退步 | P0 |
| 建议记录 | 展示/接受/拒绝的建议 ID | 写入 `advice_log`，用于避重 | P1 |

**不做**：7 天计划/打卡、情绪支持/心理疏导、诊断/用药、认知类型标签、AI 判分、AI 选维度、全网搜索、公开分享。

## 四、能力边界

| 可做 | 不可做 | 理由 |
| --- | --- | --- |
| 解释八维分数和完成度 | 算分、改分、调权重 | 分数必须可复现 |
| 从固定建议库选 2–3 条并改写 | 自创新方法/疗效 | 无法核实、无法追溯 |
| 解释维度组合与趋势 | 判断“你进步了/退步了” | 没有常模/误差范围 |
| 引用用户目标、上次建议 | 引用已删除/未授权数据 | 隐私与信任 |
| 追问时反问澄清 | 回答医疗、用药、诊断 | 非医疗器械定位 |
| 趋势解释 | 承诺训练效果 | 没有信效度证据 |

**AI 出错时，错的只能是措辞，不能是分数、结论或建议。**

## 五、总体架构

```text
前端对话
  → FastAPI /threads/{id}/messages
  → LangGraph（Postgres checkpointer）
       load_context
       → classify_intent
           ├─ crisis/out_of_scope → fixed_response
           ├─ clarify → ask_clarification
           └─ explain/advise/trend
                 → load_facts
                 → load_memory
                 → retrieve_kb（pgvector top 3）
                 → generate（BYOK）
                 → validate
                      ├─ pass → save_summary → respond
                      └─ fail → regenerate_once → template
  → 回答 + citations
```

## 六、LangGraph 设计

### 6.1 State

```python
class AgentState(TypedDict):
    user_id: str
    thread_id: str
    question: str
    intent: str
    facts: dict
    memory: dict
    retrieved: list[dict]
    draft: dict | None
    citations: list[str]
    risk_flag: str | None
    validation: dict | None
    response: dict | None
```

### 6.2 节点

| 节点 | 职责 | 失败 |
| --- | --- | --- |
| `load_context` | 用户/线程/最近消息 | 新线程 |
| `classify_intent` | 解释/建议/澄清/无关/越界/危机 | 默认解释 |
| `load_facts` | 当前/最近测评、趋势 | 无 facts → 引导测评 |
| `load_memory` | profile + 最近摘要 + 建议 | 空记忆可继续 |
| `retrieve_kb` | pgvector top 3 | 空结果 → 无引用回答 |
| `generate` | BYOK 模型 + prompt | 超时/异常 → 模板 |
| `validate` | 禁词/数字/建议 ID/长度/引用 | 重试一次 → 模板 |
| `save_summary` | 会话摘要/建议记录 | 不阻塞响应 |

### 6.3 Checkpointer

- `langgraph-checkpoint-postgres`；
- `thread_id = user_id:thread_id`；
- checkpoint 只恢复图状态，不是长期记忆；
- 不把 Key、密码、完整邮箱写入 state。

### 6.4 模型

- BYOK：每个用户独立 endpoint/model/key；
- Key 解密只在 `generate` 节点；不进 state/日志；
- 超时 45s；M1 非流式；M2 SSE 流式；
- 不调用外部工具/网页；只读 facts/记忆/知识块。

## 七、记忆系统

| 类型 | 内容 | 表 | 使用 |
| --- | --- | --- | --- |
| 短期 | 最近 20 条消息 | `chat_messages` | 当前对话 |
| 画像 | 目标/偏好/约束 | `memory_profile` | 情境化建议 |
| 摘要 | 每次测评的维度/最低项/建议/变化 | `memory_summaries` | 长期跟踪 |
| 建议 | 展示/接受/拒绝 | `advice_log` | 避重 |

规则：

- 画像由用户确认后写入；可查看/编辑/删除；
- 摘要由模板生成，模型可改写但必须引用 facts；
- 不存原始音频/转写全文；
- 用户删除后，后续回答不得引用；
- 记忆检索：最近 3 条摘要 + 画像 + 当前 facts，控制 token。

## 八、RAG 知识库

### 8.1 语料

- 8 项维度定义、任务解释、计分边界；
- 建议库（ID、适用维度、时长、禁忌）；
- 测量局限（无常模、练习效应、状态影响）；
- 安全（非诊断、危机资源、越界话术）；
- FAQ（20–30 条）。

### 8.2 切块与元数据

```json
{
  "id": "kb_wm_01",
  "title": "联想记忆分数怎么解释",
  "content": "...",
  "dim": "am",
  "source": "docs/algorithm/algorithm.md",
  "version": "scoring-v3",
  "riskLevel": "low"
}
```

- 每块 300–500 字；
- 版本化；更新时重建 embedding；
- 由团队审核后入库，不抓公网。

### 8.3 检索

- 本地 `bge-small-zh` / sentence-transformers；
- pgvector cosine top 3；
- 可加 `dim` 过滤；
- 回答附 `source`；检索不到说“不知道”。

### 8.4 评测

- 20 条检索用例，hit@3 ≥80%；
- 30 条回答用例，引用率 ≥90%。

## 九、校验与降级

### 9.1 五条核心校验

1. JSON 结构合法（`headline/body/citations`）；
2. 建议 ID 在池内，不新增；
3. 数字必须来自 facts；
4. 禁用词 0：诊断、治疗、治愈、疗效、正常、异常、提升智商、脑龄、抑郁、痴呆、ADHD；
5. 长度达标：报告 ≤200 字，追问 ≤300 字；citation ≥1（有知识块时）。

### 9.2 强制模板

- 无 facts / 数据不足；
- 复测间隔 <7 天；
- 命中危机关键词；
- 模型超时/异常/限流；
- 校验不通过且重试失败；
- 用户关闭 AI。

### 9.3 降级表

| 情况 | 处理 |
| --- | --- |
| 超时/限流/空返回 | 模板 |
| 命中禁用词 | 重试一次 → 模板 |
| 数字不在 facts | 模板 |
| 建议 ID 不在池 | 模板 |
| 无检索结果 | 无引用回答 + “知识库暂未覆盖” |
| 断网 | 前端提示 + 模板 |

## 十、隐私与安全

| 项 | 要求 |
| --- | --- |
| 数据出设备 | 只发 facts、记忆摘要、知识块；不发身份/原始音频/完整对话 |
| BYOK Key | 加密存库；主密钥环境变量；不写日志/导出 |
| 对话 | 最近 20 条；更早摘要；用户可清除 |
| 删除 | 删除账号后 30 天清除；删除后不再引用 |
| 模型厂商 | 页面披露；用户可选 provider |
| 越界 | 医疗/用药/诊断拒答；危机固定资源 |
| 日志 | 不记录 Key、密码、完整对话、完整邮箱 |

## 十一、前端交互

| 区域 | 内容 |
| --- | --- |
| 报告页 | “和 Agent 聊聊”入口；推荐问题 3 条 |
| 对话页 | 消息列表、建议卡片、引用、接受/拒绝、清除 |
| 记忆页 | 画像、摘要、建议记录、删除 |
| 趋势页 | 共同维度、复测提示、“让 Agent 解释趋势” |
| 设置 | BYOK、AI 开关、导出、注销 |

- M1 非流式；M2 SSE；
- 回答下方显示 `source`；
- 失败显示模板，不显示报错栈。

## 十二、评测

| 类型 | 数量 | 评分 |
| --- | --- | --- |
| 报告解读 | 10 | 准确/有依据/有用/无越界/长度 |
| 追问 | 10 | 同上 + 是否反问得当 |
| 趋势 | 5 | 是否只比共同维度、是否提示练习效应 |
| 越界/危机 | 5 | 是否拒答/固定资源 |
| RAG 检索 | 20 | hit@3 |

通过线：各维度平均 ≥4/5；禁用词 0；幻觉数字 0；引用率 ≥90%。

## 十三、演示脚本（5 分钟）

1. 登录 → 标准 4 项测评 → 八维报告；
2. 点“和 Agent 聊聊” → 解释最低维度；
3. 追问“为什么这项低” → 看它引用 facts/知识块；
4. 说“最近在备考” → 看它用记忆调整建议；
5. 7 天复测（演示数据）→ 趋势 → Agent 解释共同维度；
6. 问“我是不是有 ADHD” → 拒答 + 替代路径；
7. 删除记忆 → 再问，确认不再引用。

## 十四、阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M1 | facts + 对话 + 记忆 + RAG + 校验 + 趋势 | 30 条评测通过 |
| M2 | 8 项/三档/ASR；流式；建议记录 | 全链路 |
| M3 | 评测/日志/成本/隐私演练 | 可维护 |

## 十五、明确不做

- 7 天计划/打卡、情绪支持/心理疏导；
- 诊断/用药/治疗建议；
- AI 判分、AI 选维度、AI 自适应出题；
- 全网搜索、公开分享、社区；
- 全自动多 Agent；
- 保存全部对话原文。

## 十六、变更记录

| 日期 | 变更 | 原因 |
| --- | --- | --- |
| 2026-10-24 | v2.0：AI 核心三项、BYOK 直连 | L1 |
| 2026-10-24 | v3.0：L2 账号 + 服务端记忆 + LangGraph + RAG；Agent 升为核心 | 产品方向调整 |
