# MindMeter（心智镜）

> 玩一局，看清你的大脑；聊一次，知道下一步。

MindMeter 是一个 **8 项能力测评 + 对话式 Agent** 的 Web 产品：用户完成快测 2 项 / 标准 4 项 / 深度 8 项，服务端生成八维参考分；Agent 结合测评 facts、长期记忆和知识库，解释结果、给建议、回答追问、分析复测趋势。

> 本项目不是医疗器械，不提供临床诊断、治疗或危机干预。**不设总分、没有常模、不做百分位、不与人群比较。**

## 团队

| 成员 | 角色 | 主要职责 |
| --- | --- | --- |
| waibibabo666 | 项目负责人 | 进度、分工、风险、答辩/发布 |
| xlr268 | 产品负责人 | 需求、用户测试、Agent 文案、体验 |
| song | 技术负责人 | 前端、FastAPI、部署 |
| 1213lz | 技术/计分 | 计分、数据、RAG/Agent 测试 |

## 产品结构

```text
测评（8 项 / 三档）
  → 服务端计分
  → 八维报告（无总分）
  → Agent（解释 / 建议 / 追问 / 趋势）
  → 记忆（画像 / 摘要 / 建议 / 最近 20 条）
  → 知识库（测量 / 任务 / 建议 / 边界 / 安全）
  → 长期监测（复测、共同维度趋势）
```

## 技术架构

- 前端：原生 HTML/CSS/JS；
- 后端：FastAPI + PostgreSQL + pgvector；
- Agent：LangGraph + Postgres checkpointer；
- 计分：服务端 Python（`scoring-v3`）；
- 模型：用户 BYOK，Key 加密存库；
- RAG：本地 `bge-small-zh` embedding + pgvector；
- 部署：Docker + 托管 Postgres；不上 K8s/Redis/Milvus。

## 路线图（无固定 deadline）

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| M0 设计 | 领域模型、API、数据模型、隐私、知识库 schema、评测集 | 定稿 |
| M1 纵向切片 | 账号 + 标准 4 项 + 服务端计分 + 对话 + 记忆 + RAG + 趋势 | “测→聊→记住→复测→解释变化” |
| M2 完整测评 | 快测/深度、8 项、ASR、三档、练习 | 8 项跑通 |
| M3 产品化 | 评测、日志、告警、备份、部署、删除/导出 | 可维护 |

> 先做 M1，是因为 Agent 依赖的 facts/记忆/RAG 链路比“再补 4 个任务”更决定产品成败。

## 文档

| 文档 | 说明 |
| --- | --- |
| [问题定义与产品描述](docs/requirements/problem_definition.md) | Agent-first 定位、用户、竞品、路线图 |
| [功能需求规范](docs/requirements/functional_spec.md) | 账号、测评、Agent、记忆、RAG、API、数据 |
| [非功能需求规范](docs/requirements/nonfunctional_spec.md) | 性能、可靠、安全、隐私、AI 质量 |
| [Agent 设计](docs/requirements/xlragentdesign.md) | LangGraph、记忆、RAG、校验、评测 |
| [算法设计](docs/algorithm/algorithm.md) | 8 项公式、`scoring-v3`、服务端计分 |
| [技术方案](docs/software/architecture.md) | FastAPI/Postgres/pgvector/LangGraph、数据模型、部署 |
| [软件设计](docs/software/software.md) | 模块总览 |
| [用户故事](docs/research/user_stories.md) | 16 条 L2 故事与 Gherkin 验收 |
| [原型说明](docs/software/prototype/prototype.md) | L1 原型骨架（UI 参考，非最终架构） |
| [沟通计划](docs/mgmt/communication_mgmt_plan.md) | 分工、节奏、升级 |
| [风险计划](docs/mgmt/risk_mgmt_plan.md) | 范围、Key、RAG、隐私、素材 |
| [复盘模板](docs/retrospection/retrospection.md) | 阶段复盘 |

历史调研（只作追溯）：

- [认知测量框架](docs/research/rengzhi.md)
- [维度与分档调研 v2](docs/research/xlrdimensions_v2.md)
- [四维口径调研 v0.9](docs/research/xlrweidudiaoyan.md)
- [Agent 平台调研](docs/research/xlragentplatform.md)

课程提交版（历史快照，不代表 L2 当前实现）：

- [作业 1](<work_for_submission/苏打F4_MindMeter_assignment[1]_rev.md>)
- [作业 2](<work_for_submission/苏打F4_MindMeter_assignment[2]_rev.md>)
- [作业 3](<work_for_submission/苏打F4_MindMeter_assignment[3]_rev.md>)

## 仓库结构

```text
MindMeter/
├─ docs/
│  ├─ requirements/        # 问题、功能、非功能、Agent
│  ├─ research/            # 历史调研、用户故事
│  ├─ algorithm/           # 8 项计分
│  ├─ software/            # 技术方案、软件设计
│  │  └─ prototype/        # L1 原型骨架（UI 参考）
│  ├─ mgmt/                # 沟通与风险
│  └─ retrospection/
├─ code/
│  ├─ backend/            # FastAPI + Agent + RAG + scoring（L2）
│  ├─ frontend/           # 原生前端（L2）
│  └─ core_engine/        # L1 JS 计分历史
├─ tests/                  # 单测/集成/E2E
├─ work_for_submission/    # 课程提交历史快照
└─ README.md
```

## 本期范围

**做**：账号、服务端计分、8 项测评/三档、八维报告、Agent 对话/建议/追问/趋势、记忆、RAG、导出/删除、4 款练习（P2）。

**不做**：常模、百分位、总分、诊断、7 天计划/打卡、情绪支持、B 端、付费、社区、原生 App、多语言、K8s/Redis/Milvus。

## 当前状态

- 文档已切到 L2（Agent-first）；L1 的静态原型保留为 UI 参考；
- 后端/Agent/RAG 代码尚未开始；下一步按 [技术方案](docs/software/architecture.md) 搭 M1 纵向切片；
- 课程提交版只作历史快照，不代表 L2 当前口径。

## 原则

- 先纵向切片，再铺功能；
- Agent 出错只能错措辞，不能错分数/结论/建议；
- 不伪造常模、百分位、效度、误差；
- 不设总分，避免把不同结构的人压成一个数字；
- 不收集姓名/手机号等身份信息；对话只留最近 20 条 + 摘要；
- AI 默认有模板兜底；Key 加密存库、不写日志。
