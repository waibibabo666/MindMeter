# MindMeter 技术方案（L2）

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-008 |
| 版本 | v4.0（L2） |
| 状态 | 目标架构；按 M0–M3 分阶段实现 |
| 编写 | xlr268 |
| 负责人 | song |
| 评审人 | waibibabo666、1213lz |
| 最后更新 | 2026-10-24 |
| 上游 | [功能需求](../requirements/functional_spec.md)、[非功能需求](../requirements/nonfunctional_spec.md) |
| 关联 | [算法设计](../algorithm/algorithm.md)、[Agent 设计](../requirements/xlragentdesign.md)、[问题定义](../requirements/problem_definition.md) |

> 本版从 L1（纯静态 + BYOK 直连）升级为 L2：**FastAPI + PostgreSQL/pgvector + LangGraph + 原生前端**。L1 的原型保留为 UI 参考，不再代表最终架构。

## 二、摘要

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 前端 | 原生 HTML/CSS/JS，保留现有原型 | 8 个任务 + 对话/记忆/趋势；不引入构建链 |
| 后端 | FastAPI（Python） | AI/RAG/LangGraph 生态；自动 OpenAPI |
| 数据库 | PostgreSQL + pgvector | 账号/测评/记忆/知识库一体；向量检索 |
| Agent | LangGraph | 显式节点/边/状态；Postgres checkpointer |
| 计分 | 服务端 Python | 单一权威、防篡改、可测试 |
| 模型 | BYOK，加密存库 | 项目不代付；用户自选 provider |
| Embedding | 本地 bge-small-zh | 不依赖外部 embedding API |
| 部署 | Docker + 托管 Postgres | 一个 API 服务，不上 K8s |

## 三、约束

| 约束 | 说明 |
| --- | --- |
| 团队 | 4 人；后端/Agent/RAG 需要学习 |
| 周期 | 无固定 deadline；M0–M3 分阶段 |
| 技术 | FastAPI、SQLAlchemy、Alembic、LangGraph、pgvector、原生前端 |
| 模型 | BYOK；provider 必须 OpenAI-compatible chat completions |
| 数据 | 账号 + 服务端存储；18+；不留存原始音频 |
| 合规 | 非医疗器械、非诊断、非常模 |

## 四、总体架构

```text
浏览器（原生前端）
  │ HTTPS + JWT
FastAPI
  ├─ Auth（邮箱/密码/JWT/refresh）
  ├─ Assessment API（创建/提交/报告/趋势）
  ├─ Scoring（Python，8 维）
  ├─ Memory（profile / summaries / advice / 最近 20 条）
  ├─ LangGraph Agent
  │   ├─ load_context
  │   ├─ classify_intent
  │   ├─ load_facts / load_memory
  │   ├─ retrieve_kb（pgvector top 3）
  │   ├─ generate（BYOK 解密）
  │   ├─ validate
  │   └─ save_summary
  ├─ RAG（ingest / retrieve / citations）
  └─ Observability（logs / ai_runs / health）
PostgreSQL（业务表 + LangGraph checkpoint + pgvector）
```

**不上**：K8s、Kong、Redis、Milvus、Vault、Prometheus、LangSmith。需要时再评估。

## 五、仓库结构

```text
code/
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ api/              # auth, assessments, reports, threads, memory, settings, health
│  │  ├─ core/             # config, security, db, crypto, logging
│  │  ├─ models/           # SQLAlchemy
│  │  ├─ schemas/          # Pydantic
│  │  ├─ scoring/          # config.py, formulas.py, engine.py
│  │  ├─ agent/            # graph.py, state.py, nodes/, prompts.py, validation.py
│  │  ├─ rag/              # embed.py, retrieve.py, ingest.py
│  │  └─ memory/           # service.py
│  ├─ alembic/
│  ├─ tests/
│  ├─ Dockerfile
│  └─ pyproject.toml
├─ frontend/
│  ├─ index.html
│  └─ src/
│     ├─ api.js            # fetch + JWT refresh
│     ├─ auth.js
│     ├─ pages/            # login, register, report, chat, memory, trend, settings
│     ├─ tasks/            # 8 tasks
│     ├─ asr/              # Web Speech API
│     └─ styles/
└─ core_engine/            # L1 JS 计分（历史；L2 以 backend/app/scoring 为准）
```

> `core_engine` 不再参与 L2 计分；保留只用于对照 L1 原型。正式计分在 `backend/app/scoring/`。

## 六、数据模型

### 6.1 业务表

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `users` | id、email、password_hash、age_confirmed、created_at、deleted_at | 不存姓名/手机号/年龄/学历 |
| `refresh_tokens` | user_id、token_hash、expires_at、revoked_at | 可轮换 |
| `assessments` | id、user_id、tier、status、started_at、finished_at、scoring_version | 版本化 |
| `assessment_raw` | assessment_id、task_id、raw_json | 原始指标 |
| `assessment_scores` | assessment_id、dim、score、missing | 服务端结果 |
| `memory_profile` | user_id、goals、preferences、constraints、updated_at | 用户可编辑 |
| `memory_summaries` | user_id、assessment_id、summary、advice_ids、created_at | 不存全文 |
| `advice_log` | user_id、advice_id、accepted、created_at | 避重 |
| `chat_threads` | id、user_id、created_at、updated_at | LangGraph thread |
| `chat_messages` | thread_id、role、content、created_at | 只留最近 20 条 |
| `kb_chunks` | id、title、content、dim、source、version、embedding vector | pgvector |
| `ai_runs` | user_id、thread_id、model、latency_ms、degraded、validation、created_at | 不记 Key/全文 |
| `audit_log` | actor、action、object、created_at、result | 删除/导出/管理 |

### 6.2 LangGraph checkpoint

- 使用 `langgraph-checkpoint-postgres`；
- `thread_id = user_id + ":" + assessment_id/chat_thread_id`；
- checkpoint 表只负责图状态恢复，不作为长期记忆；
- 不把模型 Key 写入 state/checkpoint。

## 七、认证与安全

- 注册：邮箱 + 密码（≥10 位）；18+ 勾选；重复邮箱拒绝；
- 密码：argon2id（或 bcrypt cost≥12）；
- JWT：access 15 分钟，refresh 30 天；refresh 轮换；登出撤销；
- 限流：登录/注册/AI/导出分级；
- CORS：只允许前端域名；
- 授权：所有资源按 `user_id` 校验；越权返回 404；
- BYOK Key：AES-GCM/Fernet 加密存库；主密钥只放环境变量；不写日志/导出；
- 密码重置/邮箱验证：M2 接入邮件服务；M1 在页面明确“暂不支持自助找回”。

## 八、服务端计分

- 前端只提交原始指标（correct/hits/falseAlarms/medianRt 等）；
- 服务端校验字段/范围/完成度，按 `scoring-v3` 计算；
- 同一 assessment 重复提交幂等；
- 计分版本写入记录；旧记录不重算；
- 公式与阈值见 [算法设计](../algorithm/algorithm.md)；
- 单测：正常/边界/缺失；与 L1 原型对照仅作回归，不作为权威。

## 九、LangGraph Agent

### 9.1 State

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

### 9.2 图

```text
load_context
  → classify_intent
      ├─ crisis / out_of_scope → fixed_response
      ├─ clarify → ask_clarification
      └─ explain / advise / trend
            → load_facts
            → load_memory
            → retrieve_kb
            → generate
            → validate
                 ├─ pass → save_summary → respond
                 └─ fail → regenerate_once → fail → template
```

### 9.3 节点约定

| 节点 | 职责 | 失败 |
| --- | --- | --- |
| `load_context` | 取用户、线程、最近消息 | 回登录/新线程 |
| `classify_intent` | 规则优先；模型兜底 | 默认 explain |
| `load_facts` | 当前/最近测评、趋势 | 无 facts → 引导测评 |
| `load_memory` | profile + 最近摘要 + 建议 | 空记忆可继续 |
| `retrieve_kb` | pgvector top 3 | 空结果 → 无引用回答 |
| `generate` | BYOK 模型；模板上下文 | 超时/异常 → template |
| `validate` | 禁词/数字/建议 ID/长度/引用 | 重试一次 → template |
| `save_summary` | 会话结束写摘要/建议记录 | 失败不阻塞响应 |

### 9.4 模型调用

- BYOK：每个用户独立 endpoint/model/key；
- Key 解密只在调用节点，不进 state/日志；
- 超时 45s；失败回退模板；
- M1 非流式；M2 SSE 流式（首字 ≤3s）；
- 不调用外部工具/网页；只读 facts/记忆/知识库。

## 十、记忆

| 类型 | 内容 | 存储 | 使用 |
| --- | --- | --- | --- |
| 短期 | 最近 20 条消息 | `chat_messages` | 当前对话 |
| 画像 | 目标/偏好/约束 | `memory_profile` | 情境化建议 |
| 摘要 | 每次测评的维度/最低项/建议/变化 | `memory_summaries` | 长期跟踪 |
| 建议 | 展示/接受/拒绝 | `advice_log` | 避重 |

- 用户可查看/编辑/删除 profile；可清除全部记忆；
- 摘要由模板生成，模型可改写但必须引用 facts；
- 不把完整对话长期保存；不把已删除数据带入新回答。

## 十一、RAG

- 语料：测量/任务解释/建议库/局限/安全/FAQ；由团队审核后入库；
- 切块：300–500 字，带 `dim/source/version/riskLevel`；
- Embedding：本地 `bge-small-zh` / sentence-transformers；维度按模型配置；
- 检索：pgvector cosine top 3；可选 metadata filter；
- 回答：带 `source`；检索不到时明确“不知道”；
- 评测：20 条检索用例，hit@3 ≥80%。

## 十二、前端

| 页面 | 内容 |
| --- | --- |
| 登录/注册 | 邮箱、密码、18+、隐私同意 |
| 档位/同意 | 快测/标准/深度；ASR 提示 |
| 任务 | 8 个任务；练习；计时；提交原始指标 |
| 报告 | 八维雷达、维度分、建议、局限；无总分 |
| 对话 | 消息列表、建议卡片、引用、反馈 |
| 记忆 | 画像、摘要、建议记录、删除 |
| 趋势 | 共同维度、复测提示 |
| 设置 | BYOK、AI 开关、导出、注销 |

- 原生 JS；`api.js` 统一处理 JWT refresh；
- ASR 用 Web Speech API（Chrome/Edge）；
- 不做客户端计分；显示服务端结果。

## 十三、部署

| 项 | 方案 |
| --- | --- |
| 本地 | Docker Compose：api + postgres |
| 生产 | 1 个 API 服务 + 1 个托管 Postgres + 静态前端 |
| 迁移 | Alembic |
| 备份 | 托管 Postgres 每日备份，保留 7 天 |
| 密钥 | 环境变量/平台 secret；不入库、不日志 |
| 回滚 | 镜像 tag + 迁移回退 |
| 监控 | 结构化日志 + `ai_runs` + 健康检查；M3 接免费告警 |

## 十四、测试

| 层级 | 内容 |
| --- | --- |
| 单元 | 8 个计分公式；校验；RAG 检索；密码/JWT |
| 集成 | 注册→测评→计分→报告→对话→记忆→趋势 |
| E2E | 浏览器关键路径；ASR 失败；AI 超时；删除/导出 |
| AI 评测 | 30 条用例；RAG 20 条；禁用词/幻觉数字 |
| 安全 | 依赖扫描；越权；Key 泄露；限流 |
| 恢复 | 备份恢复演练 |

## 十五、阶段

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M0 | 数据模型/API/隐私/知识库 schema/评测集 | 定稿 |
| M1 | 账号 + 标准 4 项 + 服务端计分 + 对话 + 记忆 + RAG + 趋势 | 纵向切片跑通 |
| M2 | 快测/深度/8 项/ASR/练习 | 8 项跑通 |
| M3 | 评测/日志/告警/备份/部署/成本 | 可维护 |

## 十六、风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 范围过大 | 每块都半成品 | M1 纵向切片；先 4 项 |
| LangGraph 复杂 | 调试/版本问题 | 图小、节点可单测；prompt 不藏框架 |
| Key 托管 | 泄露 | 加密/主密钥/日志脱敏/轮换 |
| RAG 质量 | 答非所问 | 审核语料；hit@3；引用；不知道就说不知道 |
| 计分迁移 | JS/Python 分叉 | Python 唯一权威；金标准用例 |
| 隐私/合规 | 信任风险 | 同意/删除/导出/保留期/模型披露 |
| 邮件服务 | 注册/找回 | M2 接入；M1 明示限制 |
| 8 项素材 | 题库/图片授权 | M0 清单；不够减题量 |
| ASR | 浏览器限制 | Chrome/Edge；失败记未测 |

## 十七、与 L1 的关系

- L1 的静态原型、JS 计分、BYOK 直连保留为历史/UI 参考；
- L2 以本文为准；
- 迁移时优先复用前端任务 UI，不直接复用 L1 计分；
- L1 localStorage 数据可在 M3 提供导入工具，不作为 M1 范围。

## 十八、明确不做

- K8s、Kong、Redis、Milvus、Vault、Prometheus；
- 多区域/多租户/企业 SSO；
- 临床常模/诊断；
- 7 天计划/打卡/情绪支持；
- 全自动多 Agent；
- 公开分享/社区。
