# MindMeter（心智镜）

> 玩一局，看清你的大脑；聊一次，知道下一步。

[![CI](https://github.com/waibibabo666/MindMeter/actions/workflows/ci.yml/badge.svg)](https://github.com/waibibabo666/MindMeter/actions/workflows/ci.yml)
[![Docs](https://github.com/waibibabo666/MindMeter/actions/workflows/structure-check.yml/badge.svg)](https://github.com/waibibabo666/MindMeter/actions/workflows/structure-check.yml)

MindMeter 是一个 **8 项能力测评 + 对话式 Agent** 的 Web 产品：用户完成快测 2 项 / 标准 4 项 / 深度 8 项，生成八维参考分；Agent 结合测评 facts、长期记忆和知识库，解释结果、给建议、回答追问、分析复测趋势。M1 采用本地计分 + 用户自备 LLM API；L2 再引入服务端。

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
  → 计分（M1 本地 / L2 服务端）
  → 八维报告（无总分）
  → Agent（解释 / 建议 / 追问 / 趋势）
  → 记忆（画像 / 摘要 / 建议 / 最近 20 条）
  → 知识库（测量 / 任务 / 建议 / 边界 / 安全）
  → 长期监测（复测、共同维度趋势）
```

## 技术架构

**当前（桌面本地版）**

- 桌面壳：pywebview 窗口加载本地 FastAPI；
- 后端：FastAPI 子进程，只监听 `127.0.0.1`，随机端口 + 本地 token；
- 数据库：随应用分发 PostgreSQL 17.12 便携版 + Alembic；
- RAG：pgvector + 本地 `bge-small-zh-v1.5`，无模型时 BM25 fallback；
- Agent：LangGraph 小图（classify → retrieve → generate → validate）；
- 计分：服务端 Python `scoring-v3.1` 唯一权威；
- Key：Windows Credential Manager（keyring），不进前端/DB/日志/导出；
- 入口：双击 `MindMeter.cmd` / `MindMeter.vbs`。

**不再采用**

- 浏览器 localStorage 存业务数据；
- 浏览器直连 LLM API；
- SQLite 过渡方案；
- 账号/JWT/托管 Postgres（桌面单用户不需要）。

## 路线图（无固定 deadline）

| 阶段 | 目标 | 验收 |
| --- | --- | --- |
| M0 设计 | 领域模型、API、数据模型、隐私、知识库 schema、评测集 | 定稿 |
| M1 纵向切片 | 本地 App + 标准 4 项 + 本地计分 + Agent（用户 LLM API）+ 本地记忆/RAG/趋势 | “打开→测→聊→记住→复测→解释变化” |
| M2 完整测评 | 快测/深度、8 项、ASR、三档、练习 | 8 项跑通 |
| M3 产品化 | 评测、日志、告警、备份、部署、删除/导出 | 可维护 |

> 先做 M1，是因为 Agent 依赖的 facts/记忆/RAG 链路比“再补 4 个任务”更决定产品成败。M1 采用**纯本地 + 用户自备 LLM API**，不做账号/服务端；L2 服务端目标是后续阶段。

## 文档

| 文档 | 说明 |
| --- | --- |
| [问题定义与产品描述](docs/requirements/problem_definition.md) | Agent-first 定位、用户、竞品、路线图 |
| [功能需求规范](docs/requirements/functional_spec.md) | 账号、测评、Agent、记忆、RAG、API、数据 |
| [非功能需求规范](docs/requirements/nonfunctional_spec.md) | 性能、可靠、安全、隐私、AI 质量 |
| [Agent 设计](docs/requirements/xlragentdesign.md) | LangGraph、记忆、RAG、校验、评测 |
| [算法设计](docs/algorithm/algorithm.md) | 8 项公式、`scoring-v3`、服务端计分 |
| [技术方案](docs/software/architecture.md) | 历史 L2 方案；当前桌面版见 ADR/本地运行时 |
| [ADR-0001](docs/adr/0001-local-desktop-runtime.md) | 桌面本地运行时决策，取代旧 M1 范围 |
| [ADR-0002（提议）](docs/adr/0002-agent-positioning-language-contract.md) | 非临床定位与 Agent 语言契约：MoCA 参考三分法、不借诊断权威 |
| [本地运行时](docs/software/local-runtime.md) | 双击入口、便携 PostgreSQL、启停、日志、排障 |
| [迁移报告](docs/software/migration-report.md) | 保留/重写/删除、测试结果、限制 |
| [软件设计](docs/software/software.md) | 模块总览 |
| [Agent P0 改造包设计](docs/software/agent-trend-workflow.md) | 统一出口 + 趋势联动详细设计（评审稿） |
| [诊断日志](docs/software/logging.md) | 前端内存日志、脱敏、导出 |
| [用户故事](docs/research/user_stories.md) | 16 条 L2 故事与 Gherkin 验收 |
| [原型说明](docs/software/prototype/prototype.md) | L1 原型骨架（UI 参考，非最终架构） |
| [沟通计划](docs/mgmt/communication_mgmt_plan.md) | 分工、节奏、升级 |
| [风险计划](docs/mgmt/risk_mgmt_plan.md) | 范围、Key、RAG、隐私、素材 |
| [任务拆分](docs/mgmt/task_breakdown.md) | M0/M1 可执行任务、4 人分工、DoR/DoD |
| [M1 范围与验收](docs/mgmt/m1_scope.md) | M1 本地范围、验收、L-01～L-09（已确认 v1.1） |
| [AI 协作任务设计](docs/mgmt/ai_collaboration.md) | 人机分工、审查清单、关键任务卡 |
| [Issue 导入](docs/mgmt/issue_import.md) | 标签/里程碑/CSV/批量建单 |
| [复盘模板](docs/retrospection/retrospection.md) | 阶段复盘 |
| [变更日志](CHANGELOG.md) | 按版本记录每个已合并 PR 的用户可见变化 |

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

**M1 做**：本地 App、标准 4 项、本地计分、八维报告、Agent（用户 LLM API）、本地记忆/RAG/趋势、导出/清除。

**L2 目标**：账号、服务端计分、8 项/三档、ASR、练习、服务端记忆/RAG、托管部署。

**不做**：常模、百分位、总分、诊断、7 天计划/打卡、情绪支持、B 端、付费、社区、原生 App、多语言、K8s/Redis/Milvus。

## 当前状态

- 当前实现为**桌面本地版**：pywebview + FastAPI + 便携 PostgreSQL + Alembic + pgvector + LangGraph + keyring；
- 旧 `m1_scope.md` 的“无后端”范围已被 [ADR-0001](docs/adr/0001-local-desktop-runtime.md) 取代；
- 单用户、无账号/JWT；本地 API 需要每次启动的 `X-MM-Token`；
- LLM Key 只存 Windows Credential Manager，不进入前端/localStorage/日志/导出；
- 课程提交版只作历史快照，不代表当前口径。

## 开发与测试

```powershell
# 首次：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
# 或手动：python -m pip install -r requirements-dev.txt && npm ci && scripts/fetch_pgsql.ps1

npm run check          # ESLint + Prettier + 前端/纯逻辑测试
npm run complexity     # 复杂度报告（warn，不阻塞）
npm run test:e2e       # Playwright：真实本地 FastAPI + PostgreSQL

python scripts/check_docs.py
python scripts/check_secrets.py
python scripts/export_issues.py --check

# 后端测试（需要 pgvector Postgres；设 MM_TEST_DATABASE_URL 后）
pytest -q tests/backend -rs

# 双击启动 / 开发启动
.\MindMeter.cmd
python -m desktop.launcher --no-window
```

- CI：`.github/workflows/ci.yml`（Node 24：lint/format/prototype；后端契约；secret scan）；
- 文档/结构：`.github/workflows/structure-check.yml`；
- 测试说明：[tests/README.md](tests/README.md)。

后端测试在 `code/backend/pyproject.toml`（或 `requirements.txt`）出现前自动跳过；出现后若缺 `app/main.py` 会直接失败，不静默跳过。

## 原则

- 先纵向切片，再铺功能；
- Agent 出错只能错措辞，不能错分数/结论/建议；
- 不伪造常模、百分位、效度、误差；
- 不设总分，避免把不同结构的人压成一个数字；
- 不收集姓名/手机号等身份信息；对话只留最近 20 条 + 摘要；
- AI 默认有模板兜底；M1 的 Key 只存本机，不写日志/导出；L2 再加密存库。
