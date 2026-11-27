# MindMeter 文档索引

> 当前口径：**Web 托管版 = FastAPI + PostgreSQL/pgvector + LangGraph，账号登录（用户名+密码、HttpOnly Cookie 会话）、按账号隔离数据、模型由站点环境变量提供**。架构以 [ADR-0003](adr/0003-web-accounts-and-hosted-deployment.md) 为准；桌面本地形态（ADR-0001）与旧 L1/L2 文档保留为历史。

## 核心文档

| 目录 | 文档 | 状态 | 说明 |
| --- | --- | --- | --- |
| `requirements/` | [问题定义与产品描述](requirements/problem_definition.md) | 当前 v3.0 | Agent-first 定位、用户、竞品、路线图 |
| `requirements/` | [功能需求规范](requirements/functional_spec.md) | 当前 v3.0 | 账号、测评、报告、Agent、记忆、RAG、API |
| `requirements/` | [非功能需求规范](requirements/nonfunctional_spec.md) | 当前 v3.0 | 性能、可靠、安全、隐私、AI 质量 |
| `requirements/` | [Agent 设计](requirements/xlragentdesign.md) | 当前 v3.0 | LangGraph、记忆、RAG、校验、评测 |
| `algorithm/` | [算法设计](algorithm/algorithm.md) | 当前 v4.0 | 8 项公式、`scoring-v3`、服务端计分 |
| `algorithm/` | [算法调研与选型依据](algorithm/research.md) | 当前 | 候选方案、取舍、复杂度、调研索引 |
| `software/` | [技术方案](software/architecture.md) | 历史 v4.0（见 ADR） | 早期 L2 服务端设想；当前 Web 形态见 ADR-0003 |
| `software/` | [代码质量](software/code_quality.md) | 当前 | 本地门禁、CI 检查项、当前基线 |
| `software/` | [代码评审](software/code_review.md) | 当前 | 分支流程、评审清单、项目特有风险 |
| `software/` | [系统部署](software/deployment.md) | 当前 | 部署形态、两条路径、环境变量、回滚 |
| `software/` | [Railway 部署指南](software/deploy-railway.md) | 当前 | Dockerfile 构建；pgvector 模板是成败关键、`DATABASE_URL_PRIVATE` 走内网 |
| `software/` | [自建服务器部署](software/deploy-selfhost.md) | 当前 | VPS / 阿里云：Docker 与裸机两条路、cookie 与 `X-Forwarded-Proto`、备份与安全清单 |
| `software/` | [Web 本地开发与测试](software/local-development.md) | 当前 | 一键起库与服务、测试矩阵、LLM 联调、手工回归 |
| `software/` | [迁移报告](software/migration-report.md) | 当前 | 保留/重写/删除、测试结果、已知限制 |
| `adr/` | [ADR-0001 本地桌面运行时](adr/0001-local-desktop-runtime.md) | 部分被取代 | 桌面壳、loopback token、单用户与 keyring 条款由 ADR-0003 取代 |
| `adr/` | [ADR-0003 Web 账号与托管部署](adr/0003-web-accounts-and-hosted-deployment.md) | 已接受 | 账号/会话/CSRF、多租户主键、站点 LLM 配置、RAG 与探活口径 |
| `adr/` | [ADR-0002 非临床定位与 Agent 语言契约](adr/0002-agent-positioning-language-contract.md) | 提议 | MoCA 参考三分法、不借临床权威、Agent 措辞/校验约束 |
| `software/` | [Agent P0 改造包设计](software/agent-trend-workflow.md) | 评审稿 v0.2 | 统一出口 + 趋势联动 + 定位落地（受 ADR-0002 约束） |
| `slides/` | [汇报幻灯片](slides/README.md) | 当前 | Slidev 答辩稿：启动方式、审核评分 loop、截图清单 |
| `software/` | [软件设计](software/software.md) | 当前 v3.0 | 模块总览 |
| `software/` | [诊断日志](software/logging.md) | 当前 v1.0 | 前端内存日志、脱敏、导出 |
| `software/` | [本地知识库设计](software/knowledge-base.md) | 草案 v1.0 | P-06：分类、chunk schema、30 条计划、来源候选 |
| `software/` | [测试与评测计划](software/test-plan.md) | 当前 v1.0 | P-07：分层、30 条 Agent 用例、20 条检索、缺陷记录 |
| `software/` | [Agent 评测量表](software/eval-rubric.md) | 当前 v1.0 | P-07：四维评分锚点与通过标准 |
| `software/` | [知识库来源核验](software/kb-source-review.md) | 待核验 | L-06：30 条来源逐项勾选表 |
| `requirements/` | [用户故事](requirements/user_stories.md) | 当前 v3.0 | 16 条 L2 故事 + Gherkin |
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

> 历史文档顶部均有“已被取代/未采纳”的横幅；不要用它们反推当前需求。

## 课程提交版

[作业 1](<../work_for_submission/苏打F4_MindMeter_assignment[1]_rev.md>)、[作业 2](<../work_for_submission/苏打F4_MindMeter_assignment[2]_rev.md>)、[作业 3](<../work_for_submission/苏打F4_MindMeter_assignment[3]_rev.md>) 是 2026-10-24 的课程提交快照，**不代表 L2 当前实现**；当前口径以本索引的“当前”文档为准。

## 说明

- L2 的 Agent 是核心，不是“报告下的解读卡片”；
- 8 项是产品口径，不是学界公认的“8 种智力”；本期不测工作记忆、抑制控制、认知灵活性；
- 不设总分、没有常模、不做百分位、不给误差范围；
- 账号、服务端记忆、RAG、BYOK 加密存库是 L2 的新增面，隐私/安全要求见 NFR。
