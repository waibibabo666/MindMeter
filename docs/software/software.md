# MindMeter 软件设计

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-DES-002 |
| 版本 | v3.0（L2） |
| 状态 | 目标设计；细节见技术方案 |
| 文档负责人 | song |
| 评审人 | waibibabo666、xlr268、1213lz |
| 最后更新 | 2026-10-24 |
| 关联 | [功能需求](../requirements/functional_spec.md)、[算法设计](../algorithm/algorithm.md)、[技术方案](architecture.md)、[Agent 设计](../requirements/xlragentdesign.md) |

> 本文只保留 L2 软件设计总览。技术选型、数据模型、API、LangGraph 图、RAG、部署与阶段以[技术方案](architecture.md)为准，避免两份文档各写一套。

## 二、目标与约束

L2 是一个**有账号、有服务端记忆、有对话式 Agent** 的 Web 产品：

- 用户注册/登录，跨设备查看测评与记忆；
- 8 项测评、三档、服务端计分；
- Agent 做报告解读、建议、追问、趋势解释；
- 记忆：最近 20 条消息 + 画像 + 测评摘要 + 建议记录；
- RAG：本地知识库 + pgvector 检索 + 引用；
- 模型 BYOK，Key 加密存库；
- 原生前端 + FastAPI + PostgreSQL/pgvector + LangGraph；
- 不引入 K8s/Redis/Milvus，保持 4 人可维护。

## 三、模块

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| `frontend` | 登录/注册、测评、报告、对话、记忆、趋势、设置 | 不计分、不直连模型 |
| `backend/api` | Auth、Assessment、Report、Thread、Memory、Settings、Health | 不写 Agent prompt |
| `backend/scoring` | 8 维计分、缺失处理、版本 | 不碰 DOM/网络 |
| `backend/agent` | LangGraph 图、节点、prompt、校验 | 不改分数、不新增建议 |
| `backend/rag` | 知识库 ingest、embedding、检索、引用 | 不抓公网 |
| `backend/memory` | profile/summaries/advice/最近消息 | 不存全量对话 |
| `backend/core` | 配置、DB、安全、加密、日志 | — |
| `postgres` | 业务表 + pgvector + LangGraph checkpoint | — |
| `tests` | 单测/集成/E2E/AI 评测 | 不使用真实用户数据 |

## 四、目录

```text
code/
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ api/
│  │  ├─ core/
│  │  ├─ models/
│  │  ├─ schemas/
│  │  ├─ scoring/
│  │  ├─ agent/
│  │  ├─ rag/
│  │  └─ memory/
│  ├─ alembic/
│  ├─ tests/
│  ├─ Dockerfile
│  └─ pyproject.toml
└─ frontend/
   ├─ index.html
   └─ src/
      ├─ api.js
      ├─ auth.js
      ├─ pages/
      ├─ tasks/
      ├─ asr/
      └─ styles/
```

> `code/core_engine/` 是 L1 JS 计分历史，L2 不再参与计分；正式计分在 `backend/app/scoring/`。

## 五、数据流

```text
登录
  → 创建 assessment
  → 前端跑任务，提交原始指标
  → 服务端计分 + 落库
  → 八维报告（无总分）
  → 创建 thread
  → LangGraph:
       取 facts + 记忆 → 检索知识库 → 生成 → 校验
  → 回答 + 引用
  → 会话结束写摘要
  → 7 天后复测 → 趋势 → Agent 解释共同维度
```

## 六、数据与存储

| 数据 | 存储 | 保留 |
| --- | --- | --- |
| 账号 | `users` / `refresh_tokens` | 账号存续期；删除后 30 天清除 |
| 测评 | `assessments` / `assessment_raw` / `assessment_scores` | 账号存续期 |
| 记忆 | `memory_profile` / `memory_summaries` / `advice_log` | 账号存续期；可删 |
| 对话 | `chat_messages` | 最近 20 条；更早只留摘要 |
| 知识库 | `kb_chunks`（pgvector） | 版本化 |
| AI 运行 | `ai_runs` | 30–180 天；不记 Key/全文 |
| 审计 | `audit_log` | 180 天 |

- 不存姓名、手机号、学校、公司、年龄、学历；
- 不存原始 ASR 音频/转写全文；
- BYOK Key 加密存库，主密钥只放环境变量；
- 导出不含密码/Key。

## 七、部署

| 项 | 方案 |
| --- | --- |
| 本地 | Docker Compose：api + postgres |
| 生产 | 1 个 API 服务 + 1 个托管 Postgres + 静态前端 |
| 迁移 | Alembic |
| 备份 | 托管 Postgres 每日备份，7 天 |
| 监控 | 结构化日志 + `ai_runs` + 健康检查 |
| 回滚 | 镜像 tag + 迁移回退 |

## 八、关键取舍

- **服务端计分**：单一权威、防篡改；代价是 Python 重写 8 个公式。
- **BYOK 加密存库**：用户不用每次填 Key；代价是托管风险与主密钥管理。
- **LangGraph**：显式图/状态/checkpoint；代价是框架复杂度，prompt 和校验仍留在自己代码。
- **本地 embedding**：不依赖外部 embedding API；代价是 CPU/模型依赖。
- **原生前端**：不引入构建链；代价是复杂交互要自己组织模块。
- **不上 K8s/Redis/Milvus**：4 人维护；需要时再评估。

## 九、与 L1 的关系

- L1 的静态原型、JS 计分、BYOK 直连保留为历史/UI 参考；
- L2 以本文和[技术方案](architecture.md)为准；
- 迁移时优先复用前端任务 UI，不直接复用 L1 计分；
- L1 localStorage 数据可在 M3 提供导入工具，不作为 M1 范围。
