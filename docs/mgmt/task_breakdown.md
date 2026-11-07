# MindMeter L2 任务拆分（M0–M1 可执行版）

> **2026-11-07 范围变更**：M1 已改为**纯本地 + 用户自备 LLM API**（无远端登录/账号/服务端存储）。本页 50 条任务是 **L2 目标 backlog**；M1 只执行 [M1 范围与验收](m1_scope.md) 里的 **L-01～L-09**。原 P-02～P-05 / BE / AS 服务端 / RAG pgvector / Agent LangGraph 任务在 M1 不启动；需要时再按 L2 重写。

## 一、文档信息

| 项目 | 内容 |
| --- | --- |
| 文档编号 | MM-PM-004 |
| 版本 | v1.1 |
| 状态 | L2 backlog + M1 本地执行（L-01～L-09） |
| 文档负责人 | waibibabo666 |
| 评审人 | xlr268、song、1213lz |
| 最后更新 | 2026-11-07 |
| 上游 | [问题定义](../requirements/problem_definition.md)、[功能需求](../requirements/functional_spec.md)、[技术方案](../software/architecture.md) |
| 关联 | [Agent 设计](../requirements/xlragentdesign.md)、[用户故事](../research/user_stories.md)、[测试说明](../../tests/README.md) |

> 目标：把 L2 需求拆成可执行任务，先完成 M1 纵向切片（账号 + 标准 4 项 + 服务端计分 + 对话 + 记忆 + RAG + 趋势），再进入 M2（8 项/三档/ASR）。M0–M1 约 **70.5 人日**（按人的 brief/review/验收/集成计，不把 AI 生成时间当工期）。
>
> 四个人都有 vibe coding 工具：每张卡的人机分工、审查清单和关键任务卡见 [AI 协作下的任务设计](ai_collaboration.md)。AI 可以写初稿，但 authz、计分语义、Agent 安全、Key、发布必须由人负责。

## 二、用法

- 每个任务 0.5–3 人日；超过 3 人日必须再拆；
- 每个任务必须有：负责人、支持人、依赖、验收、测试点；
- 看板列：`Backlog → Ready → In Progress → Review → Done`；
- 任务进入 `Ready` 前满足 DoR；进入 `Done` 前满足 DoD。

### DoR（Definition of Ready）

- 关联到需求/用户故事/API/数据模型；
- 验收条件可判定；
- 测试点已写；
- 依赖已清或标注；
- 负责人/支持人明确。

### DoD（Definition of Done）

- 代码 + 单测/集成测试；
- API/数据模型/README 同步；
- CI 绿（docs、prototype、backend、secret）；
- 至少 1 人 review；auth/Key/计分需 2 人；
- 无真实用户数据、无 Key/PII 入库；
- 行为变化已写变更记录。

## 三、4 人分工

| 成员 | 主责 | 支持 | 负荷注意 |
| --- | --- | --- | --- |
| waibibabo666 | 项目/DB/CI/部署/安全 | 后端、发布 | 还承担协调与评审，任务量故意留余量 |
| xlr268 | 产品/UX、Agent 图/prompt/校验、用户测试 | 前端聊天/记忆/趋势 | 后端接口未定前先用 mock 推进 Agent |
| song | FastAPI、Auth、BYOK、前端壳/报告/设置、Agent 模型节点 | 部署 | 任务最重，需把部分前端交给 xlr |
| 1213lz | 服务端计分、RAG/检索、测试/评测 | 后端 assessment/memory | 计分与 RAG 可并行，但不能同时压到最后 |

### 工作流负责人

| 工作流 | Lead | Support | 最终负责 |
| --- | --- | --- | --- |
| 产品/UX | xlr268 | song | waibibabo666 |
| 后端/API/DB | song | waibibabo666、1213lz | song |
| 计分/数据 | 1213lz | song | song |
| Agent/RAG | xlr268 | 1213lz、song | xlr268 |
| 前端 | song | xlr268 | song |
| QA/CI/部署 | waibibabo666 | 1213lz | waibibabo666 |

### 粗略负荷（M0+M1，按主责任务估算）

| 成员 | 主责任务 | 约人日 | 说明 |
| --- | --- | --- | --- |
| song | P-02/04、BE-01/03/04/07/08、AG-03、FE-01/03/04/08/09、OPS-01 | ≈17.5 | 最重；FE-05/06 已交给 xlr，BE-05/06 交给 1213lz |
| xlr268 | P-05/08、AG-01/02/04/05/06、FE-02/05/06/07、QA-04 | ≈20.5 | Agent+前端+用户测试，注意别压到测试周 |
| 1213lz | P-06/07、BE-05/06/10、AS-01..04、RG-02/03、AG-07 | ≈18.5 | 计分/RAG 可并行；RAG 环境要早验 |
| waibibabo666 | P-01/03/09、BE-02/09、QA-01/02/03/05、OPS-02/03 | ≈12 + 协调 | 留出评审/协调余量，不再塞满开发 |

> 负荷是主责任务口径，不含 review/会议/返工；实际排期按 70% 可用时间估。

## 四、里程碑与门禁

| 门禁 | 内容 | 通过标准 |
| --- | --- | --- |
| G0 M0 契约 | API/DB/Agent/KB/评测/线框 | 4 人评审通过，任务进入 Ready |
| G1 走后端 | health + register/login + assessment create/submit + report | CI backend 真正运行；curl/pytest 通过 |
| G2 纵向切片 | 标准 4 项→报告→对话→记忆→趋势 | 一个用户全链路走通；30 条 Agent 评测 |
| G3 可用性 | 5–10 人测试、删除/导出、安全 | 完成率/理解率达标；无 P0/P1 缺陷 |
| G4 M1 冻结 | 文档/部署/回滚 | M1 演示可复现 |
| M2 | 快测/深度/8 项/ASR/练习 | 另拆任务 |
| M3 | 评测/告警/备份/成本 | 另拆任务 |

## 五、M0 契约（11 人日）

> P-01 产出：[M1 范围与验收](m1_scope.md)（v1.1 已冻结，纯本地）。P-02～P-05 的旧口径是 L2 目标；M1 本地契约见 m1_scope 的 L-01～L-09，原 Issue #26～#29 需重写后再启动。

| ID | 任务 | 负责人 | 支持 | 估算 | 依赖 | 验收/测试 |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | 冻结 M1 范围与验收 | waibibabo666 | xlr268 | 0.5 | 无 | 1 页范围+验收；4 人确认 |
| P-02 | API 契约 v1（auth/assessment/report/thread/memory/trend） | song | xlr268 | 1.5 | P-01 | OpenAPI 路径/错误格式/401/429；契约测试 |
| P-03 | DB schema + ERD + Alembic 初始迁移 | waibibabo666 | song | 1.5 | P-02 | 表/索引/外键；迁移可回退 |
| P-04 | Auth/安全设计（argon2/JWT/refresh/BYOK 加密/限流） | song | waibibabo666 | 1 | P-02 | 威胁清单；Key 不落日志 |
| P-05 | LangGraph State/节点/prompt/校验契约 | xlr268 | 1213lz | 1.5 | 功能/Agent 文档 | 图+State+节点 IO；fake model 可跑 |
| P-06 | 知识库分类、chunk schema、来源清单 | 1213lz | xlr268 | 1 | Agent 设计 | 30 条 chunk 计划；source/version/risk |
| P-07 | 测试/评测计划 + 30 Agent/20 RAG 用例骨架 | 1213lz | xlr268 | 1.5 | P-05 | 用例文件；评分 rubric；hit@3 |
| P-08 | 线框：登录/档位/任务/报告/对话/记忆/趋势 | xlr268 | song | 2 | P-02 | 360px 线框；文案；无总分 |
| P-09 | M0 评审/门禁 | waibibabo666 | 全体 | 0.5 | P-01..08 | 决策记录；任务进 Ready |

## 六、后端平台（L2 目标，不进入 M1；14 人日）

| ID | 任务 | 负责人 | 支持 | 估算 | 依赖 | 验收/测试 |
| --- | --- | --- | --- | --- | --- | --- |
| BE-01 | FastAPI 脚手架：config/logging/error/health | song | waibibabo666 | 0.5 | P-02 | `/api/v1/health`；backend CI 激活 |
| BE-02 | SQLAlchemy 模型 + Alembic | waibibabo666 | song | 1.5 | P-03 | 迁移跑通；模型测试 |
| BE-03 | Auth：register/login/refresh/logout | song | waibibabo666 | 2 | BE-01/02/P-04 | 401/409/429；token 轮换 |
| BE-04 | BYOK 加密 + settings API | song | waibibabo666 | 1 | BE-03 | AES-GCM；Key 不出日志/导出 |
| BE-05 | Assessment create/submit/draft | 1213lz | song | 2 | BE-02/AS-01 | 原始指标提交；幂等；draft 24h |
| BE-06 | Report + trends 接口 | 1213lz | song | 1.5 | BE-05 | 八维/未测/无总分；共同维度 |
| BE-07 | Memory：profile/summaries/advice/delete/export | song | 1213lz | 2 | BE-02 | 可编辑/删除；导出不含 Key |
| BE-08 | Threads/messages | song | xlr268 | 1 | BE-07 | 最近 20 条；越权 404 |
| BE-09 | 限流/CORS/错误格式/审计 | waibibabo666 | song | 1 | BE-01 | 429；只允许前端域；审计表 |
| BE-10 | 后端集成测试 | 1213lz | waibibabo666 | 1.5 | BE-03..08 | happy/error；pytest 全绿 |

## 七、服务端计分（L2 目标；M1 用 L-02 本地计分；5.5 人日）

| ID | 任务 | 负责人 | 支持 | 估算 | 依赖 | 验收/测试 |
| --- | --- | --- | --- | --- | --- | --- |
| AS-01 | `scoring-v3` 配置 + 8 维公式 | 1213lz | song | 2.5 | 算法文档 | 8 维；无总分；版本 |
| AS-02 | 金标准用例 + 单测 | 1213lz | song | 1 | AS-01 | 正常/边界/缺失；手算一致 |
| AS-03 | 提交校验/范围/缺失处理 | 1213lz | song | 1 | AS-01/BE-05 | 非法拒绝；缺失 null |
| AS-04 | 8 个任务的原始指标 schema | 1213lz | song | 1 | 功能文档 | Pydantic；M1 4 项先可用 |

## 八、RAG（L2 目标；M1 用 L-06 本地 RAG；5.5 人日）

| ID | 任务 | 负责人 | 支持 | 估算 | 依赖 | 验收/测试 |
| --- | --- | --- | --- | --- | --- | --- |
| RG-01 | 知识库 v1：30 条 chunk | xlr268 | 1213lz | 2 | P-06 | 维度/任务/建议/局限/安全；审核 |
| RG-02 | 本地 embedding + pgvector ingest | 1213lz | song | 2 | RG-01/BE-02 | bge-small-zh；可重建；幂等 |
| RG-03 | 检索 + 引用 + hit@3 测试 | 1213lz | xlr268 | 1.5 | RG-02 | top3；metadata；20 用例 |

## 九、Agent（L2 目标；M1 用 L-05 本地 Agent；11.5 人日）

| ID | 任务 | 负责人 | 支持 | 估算 | 依赖 | 验收/测试 |
| --- | --- | --- | --- | --- | --- | --- |
| AG-01 | LangGraph 骨架/State/checkpointer | xlr268 | song | 1.5 | P-05/BE-01 | fake model 图跑通；checkpoint |
| AG-02 | load_context/classify/load_facts/load_memory | xlr268 | 1213lz | 2 | AG-01/BE-05/07 | 意图；无 facts 引导测评 |
| AG-03 | retrieve/generate + BYOK client | song | xlr268 | 2 | AG-01/RG-03/BE-04 | 超时 45s；Key 不进 state/日志 |
| AG-04 | validate 节点 | xlr268 | 1213lz | 2 | AG-03 | 禁词/数字/建议 ID/长度/引用；重试 |
| AG-05 | save_summary + memory/advice | xlr268 | song | 1 | AG-04/BE-07 | 摘要；不存全文；删除不引用 |
| AG-06 | 模板兜底/degraded | xlr268 | 1213lz | 1 | AG-04 | 报告/对话不空；无堆栈 |
| AG-07 | 30 条 Agent 评测 + 20 条 RAG | 1213lz | xlr268 | 2 | AG-04/05 | 各 ≥4/5；禁用词/幻觉 0 |

## 十、前端（M1 用 L-01/L-07/L-08；其余 L2；13 人日）

| ID | 任务 | 负责人 | 支持 | 估算 | 依赖 | 验收/测试 |
| --- | --- | --- | --- | --- | --- | --- |
| FE-01 | API client + JWT refresh | song | xlr268 | 1 | P-02 | 401 自动刷新；Key 不进 URL |
| FE-02 | 登录/注册/同意页 | xlr268 | song | 1.5 | FE-01/BE-03 | 18+；错误提示；不收集人口学 |
| FE-03 | 测评壳：档位/同意/任务/提交 | song | xlr268 | 2.5 | FE-01/BE-05 | 标准 4 项；只交原始指标 |
| FE-04 | 报告页：八维雷达/无总分/未测 | song | xlr268 | 1.5 | FE-03/BE-06 | 8 轴；无总分；移动端 |
| FE-05 | 对话：消息/建议卡/引用/降级 | xlr268 | song | 2 | FE-04/BE-08/AG-06 | 最近 20 条；citation |
| FE-06 | 记忆：画像/摘要/删除 | xlr268 | song | 1.5 | FE-01/BE-07 | 编辑/删除；删除后不引用 |
| FE-07 | 趋势：共同维度/7 天提示 | xlr268 | song | 1 | FE-04/BE-06 | 只比共同维度；无总分 |
| FE-08 | 设置：BYOK/AI 开关/导出/注销 | song | xlr268 | 1 | FE-01/BE-04 | Key 掩码；清除生效 |
| FE-09 | 响应式/无障碍走查 | song | xlr268 | 1 | FE-02..08 | 360px；键盘；对比度 |

## 十一、QA / Ops（M1 用 L-09；其余 L2；10 人日）

| ID | 任务 | 负责人 | 支持 | 估算 | 依赖 | 验收/测试 |
| --- | --- | --- | --- | --- | --- | --- |
| QA-01 | 激活 backend CI + 测试数据 | waibibabo666 | 1213lz | 1 | BE-01 | pyproject/requirements 后 backend job 真跑 |
| QA-02 | E2E smoke：登录→标准→报告→对话 | waibibabo666 | xlr268 | 1.5 | FE-03/05 | Playwright；关键路径 |
| QA-03 | 安全：越权/限流/Key 日志 | waibibabo666 | song | 1 | BE-03/04/09 | 404/429；无 Key |
| QA-04 | 5–10 人用户测试 + 报告 | xlr268 | 全体 | 2 | G2 | 完成率/理解率；问题清单 |
| OPS-01 | Docker Compose + `.env.example` | song | waibibabo666 | 1 | BE-01/02 | api+db 一键起；无密钥 |
| OPS-02 | 部署 API + Postgres + 前端 | waibibabo666 | song | 1 | OPS-01 | HTTPS；health；回滚 |
| OPS-03 | 日志/备份恢复演练 | waibibabo666 | song | 1.5 | OPS-02 | 日志脱敏；恢复一次 |
| QA-05 | 发布检查表/运行手册 | waibibabo666 | 1213lz | 1 | QA-01..03 | 可交接 |

## 十二、关键路径与并行

> **M1 本地关键路径**见 [M1 范围与验收](m1_scope.md) 的 L-01～L-09；以下为 L2 目标路径。

**关键路径（L2）**：

```text
P-02 API → BE-01/02 → BE-03/05 → AS-03 → BE-06
  → FE-03/04 → FE-05 → QA-02 → G2
```

**可并行**：

- AS-01/02 从算法文档直接开始，不等后端；
- RG-01/02 在 DB 就绪后开始，不等 Agent；
- AG-01/02 用 fake facts 先跑，不等真实测评；
- FE-01/02 在 API 契约后开始，用 mock 联调；
- CI/OPS 在 BE-01 后开始；
- P-08 线框与 P-02 API 并行。

**瓶颈**：

1. song 同时承担 Auth/BYOK/前端壳/报告/模型节点，是最容易过载的人；FE-05/FE-06 尽量由 xlr 承担，BE-07/BE-05 可由 1213lz 分担。
2. Agent 的 validate/eval 依赖 xlr + 1213lz，必须早于“对话 UI 完成”。
3. RAG 的 embedding 环境（torch/sentence-transformers）可能拖慢 CI；先本地验证，CI 只跑检索契约。
4. BYOK 加密/主密钥管理必须一开始就定，不能最后补。

## 十三、第一个迭代（建议 10 个工作日）

> **M1 本地第一迭代**见 [M1 范围与验收](m1_scope.md) 的 L-01～L-09；以下为 L2 目标迭代，暂不启动。

| 顺序 | 任务 | 负责人 | 产出 |
| --- | --- | --- | --- |
| 1 | P-01/P-02/P-03/P-04 | wai/song | 范围、API、DB、Auth 契约 |
| 2 | P-05/P-06/P-07 | xlr/1213lz | Agent 图、KB schema、评测骨架 |
| 3 | P-08 | xlr | 7 个页面线框 |
| 4 | BE-01/BE-02 | song/wai | FastAPI + Postgres 起得来 |
| 5 | AS-01/02 | 1213lz | 8 维公式 + 金标准 |
| 6 | RG-01 | xlr/1213lz | 30 条知识块 |
| 7 | FE-01/FE-02 | song/xlr | 登录/注册/同意 |
| 8 | QA-01 | wai | backend CI 从 skip 变真跑 |

**迭代出口**：G1 走后端——health、register/login、assessment create/submit、report 能跑；CI 绿。

## 十四、任务板初始化建议

- 标签：`area:backend`、`area:frontend`、`area:agent`、`area:rag`、`area:scoring`、`area:qa`、`area:ops`；
- 优先级：`P0`（M1 阻断）、`P1`（M1 应有）、`P2`（M2/M3）；
- 每个 Issue 标题：`[BE-03] Auth register/login/refresh/logout`；
- Issue 模板包含：背景、验收、测试点、依赖、估算、DoR/DoD。

## 十五、风险与调整规则

- 任何任务超过 3 人日 → 再拆；
- 任何阻塞超过 1 天 → 当天升级；
- Agent/RAG 评测不达标 → 先回退模板，不阻塞报告；
- 8 项任务/ASR 属于 M2，不在 M1 抢跑；
- 课程提交版只作历史，不随 L2 任务改。

## 十六、变更记录

| 日期 | 变更 | 原因 |
| --- | --- | --- |
| 2026-11-07 | v1.0：M0/M1 任务拆分、4 人分工、DoR/DoD、第一个迭代 | 进入合作开发 |
| 2026-11-07 | v1.1：M1 改为纯本地 + 用户 LLM API；L2 服务端任务降为 backlog；M1 执行清单移到 m1_scope L-01～L-09 | 团队面对面决策 |

## 附：Issue 导入

- 任务导入说明：[issue_import.md](issue_import.md)
- 生成/校验 CSV：`python scripts/export_issues.py` / `python scripts/export_issues.py --check`
- 批量建单：`python scripts/create_issues.py --dry-run`（确认后再 `--apply`）

