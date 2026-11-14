# MindMeter 文档索引

> 当前口径：**桌面本地版 = pywebview + FastAPI + 便携 PostgreSQL + pgvector + LangGraph + keyring；单用户、无账号/JWT**。旧 L1/L2 文档保留为历史；架构以 [ADR-0001](adr/0001-local-desktop-runtime.md) 为准。

## 核心文档

| 目录 | 文档 | 状态 | 说明 |
| --- | --- | --- | --- |
| `requirements/` | [问题定义与产品描述](requirements/problem_definition.md) | 当前 v3.0 | Agent-first 定位、用户、竞品、路线图 |
| `requirements/` | [功能需求规范](requirements/functional_spec.md) | 当前 v3.0 | 账号、测评、报告、Agent、记忆、RAG、API |
| `requirements/` | [非功能需求规范](requirements/nonfunctional_spec.md) | 当前 v3.0 | 性能、可靠、安全、隐私、AI 质量 |
| `requirements/` | [Agent 设计](requirements/xlragentdesign.md) | 当前 v3.0 | LangGraph、记忆、RAG、校验、评测 |
| `algorithm/` | [算法设计](algorithm/algorithm.md) | 当前 v4.0 | 8 项公式、`scoring-v3`、服务端计分 |
| `software/` | [技术方案](software/architecture.md) | 历史 v4.0（见 ADR） | 早期 L2 服务端设想；当前桌面版见本地运行时 |
| `software/` | [本地运行时](software/local-runtime.md) | 当前 | 双击入口、便携 PostgreSQL、启停、日志、排障 |
| `software/` | [迁移报告](software/migration-report.md) | 当前 | 保留/重写/删除、测试结果、已知限制 |
| `adr/` | [ADR-0001 本地桌面运行时](adr/0001-local-desktop-runtime.md) | 已接受 | 取代 m1_scope 的“无后端”范围 |
| `adr/` | [ADR-0002 非临床定位与 Agent 语言契约](adr/0002-agent-positioning-language-contract.md) | 提议 | MoCA 参考三分法、不借临床权威、Agent 措辞/校验约束 |
| `software/` | [Agent P0 改造包设计](software/agent-trend-workflow.md) | 评审稿 v0.2 | 统一出口 + 趋势联动 + 定位落地（受 ADR-0002 约束） |
| `software/` | [软件设计](software/software.md) | 当前 v3.0 | 模块总览 |
| `software/` | [诊断日志](software/logging.md) | 当前 v1.0 | 前端内存日志、脱敏、导出 |
| `software/` | [本地知识库设计](software/knowledge-base.md) | 草案 v1.0 | P-06：分类、chunk schema、30 条计划、来源候选 |
| `software/` | [测试与评测计划](software/test-plan.md) | 当前 v1.0 | P-07：分层、30 条 Agent 用例、20 条检索、缺陷记录 |
| `software/` | [Agent 评测量表](software/eval-rubric.md) | 当前 v1.0 | P-07：四维评分锚点与通过标准 |
| `software/` | [知识库来源核验](software/kb-source-review.md) | 待核验 | L-06：30 条来源逐项勾选表 |
| `research/` | [用户故事](research/user_stories.md) | 当前 v3.0 | 16 条 L2 故事 + Gherkin |
| `software/prototype/` | [原型说明](software/prototype/prototype.md) | L1 参考 | UI 骨架；不代表 L2 架构 |
| `software/prototype/` | [AI 接入位](software/prototype/agent-接入位.md) | 当前 L2 | 前端 → FastAPI 的 Agent 契约；前端不直连模型 |
| `mgmt/` | [沟通管理计划](mgmt/communication_mgmt_plan.md) | 当前 v2.0 | 分工、阶段节奏、升级 |
| `mgmt/` | [风险管理计划](mgmt/risk_mgmt_plan.md) | 当前 v2.0 | 范围、Key、RAG、隐私、素材 |
| `mgmt/` | [任务拆分](mgmt/task_breakdown.md) | 当前 v1.1 | L2 backlog + M1 本地执行（L-01～L-09） |
| `mgmt/` | [M1 范围与验收](mgmt/m1_scope.md) | 历史 v1.1（被 ADR 取代） | M1 本地范围、验收、L-01～L-09 |
| `mgmt/` | [AI 协作任务设计](mgmt/ai_collaboration.md) | 当前 v1.0 | 人机分工、审查清单、关键任务卡 |
| `mgmt/` | [Issue 导入](mgmt/issue_import.md) | 当前 v1.0 | 标签/里程碑/CSV/批量建单 |
| `retrospection/` | [复盘模板](retrospection/retrospection.md) | 模板 | 阶段复盘 |

## 历史调研（只作追溯）

| 文档 | 说明 |
| --- | --- |
| [认知测量框架](research/rengzhi.md) | 常模/百分位/±6 分建议未被采纳 |
| [维度与分档调研 v2](research/xlrdimensions_v2.md) | 4/7 维旧口径 |
| [四维口径调研 v0.9](research/xlrweidudiaoyan.md) | “四项不换”旧结论 |
| [Agent 平台调研](research/xlragentplatform.md) | 平台对比；L1 的 serverless 结论不再采用 |
| [requirements/xlrweidudiaoyan.md](requirements/xlrweidudiaoyan.md) | 已合并，只剩指针 |

> 历史文档顶部均有“已被取代/未采纳”的横幅；不要用它们反推当前需求。

## 课程提交版

[作业 1](<../work_for_submission/苏打F4_MindMeter_assignment[1]_rev.md>)、[作业 2](<../work_for_submission/苏打F4_MindMeter_assignment[2]_rev.md>)、[作业 3](<../work_for_submission/苏打F4_MindMeter_assignment[3]_rev.md>) 是 2026-10-24 的课程提交快照，**不代表 L2 当前实现**；当前口径以本索引的“当前”文档为准。

## 说明

- L2 的 Agent 是核心，不是“报告下的解读卡片”；
- 8 项是产品口径，不是学界公认的“8 种智力”；本期不测工作记忆、抑制控制、认知灵活性；
- 不设总分、没有常模、不做百分位、不给误差范围；
- 账号、服务端记忆、RAG、BYOK 加密存库是 L2 的新增面，隐私/安全要求见 NFR。
