# MindMeter（心智镜）

> 玩一局，看清你的大脑；聊一次，知道下一步。

[![CI](https://github.com/waibibabo666/MindMeter/actions/workflows/ci.yml/badge.svg)](https://github.com/waibibabo666/MindMeter/actions/workflows/ci.yml)
[![Docs](https://github.com/waibibabo666/MindMeter/actions/workflows/structure-check.yml/badge.svg)](https://github.com/waibibabo666/MindMeter/actions/workflows/structure-check.yml)

MindMeter 是一个 **8 项能力测评 + 对话式 Agent** 的 Web 产品：用户完成快测 2 项 / 标准 4 项 / 深度 8 项，生成八维参考分；Agent 结合测评 facts、长期记忆和知识库，解释结果、给建议、回答追问、分析复测趋势。当前为 **L2 托管版**：账号登录、服务端计分、按账号隔离的记忆/RAG/趋势，AI 用站点统一提供的 LLM API。

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

**当前（Web 托管版，Railway）**

- 服务：单个 FastAPI 服务同源托管 `/api/v1/*` 与前端静态文件（无 CORS、无独立前端服务）；
- 账号：用户名 + 密码（PBKDF2-SHA256），HttpOnly + SameSite=Lax 会话 Cookie，服务端会话表，30 天滑动续期；
- 多租户：所有业务表以 `user_id` 为复合主键第一列，`kb_chunks` 全站共享只读；
- 数据库：Railway pgvector 模板（PostgreSQL + pgvector）+ Alembic（启动时 `MM_AUTO_MIGRATE=1` 迁移）；
- RAG：默认 BM25 关键词检索（`MM_RAG_MODE=keyword`），向量检索能力保留但不进 Web 依赖；
- Agent：LangGraph 小图（classify → retrieve → generate → validate），模型不可用即回退模板；
- AI：站点统一 LLM API，`MM_LLM_BASE_URL` / `MM_LLM_MODEL` / `MM_LLM_API_KEY` 只在服务端；
- 计分：服务端 Python `scoring-v3.2` 唯一权威（与前端引擎逐维一致）；
- 部署：`Dockerfile` + `railway.json`（Railway）+ [Railway 部署指南](docs/software/deploy-railway.md)；本地一键起服见 [本地开发与测试](docs/software/local-development.md)。

**不再采用（相关代码已于 2026-11-20 删除）**

- 浏览器 localStorage 存业务数据；
- 浏览器直连 LLM API、用户自填 Key（BYOK）：`src/llm/*`、`src/agent/*` 已从前端移除；
- Windows 凭据管理器（keyring）存 Key；
- pywebview 桌面壳、`127.0.0.1` + 每次启动 token 的本地守卫：`code/desktop/`、`MindMeter.cmd/.vbs` 已删除；
- SQLite 过渡方案。

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
| [技术方案](docs/software/architecture.md) | 历史 L2 方案；当前 Web 形态见 ADR-0003 |
| [Railway 部署指南](docs/software/deploy-railway.md) | Dockerfile 构建、pgvector 数据库、环境变量、验收与排障 |
| [ADR-0001](docs/adr/0001-local-desktop-runtime.md) | 桌面本地运行时决策（部分被 ADR-0003 取代） |
| [ADR-0003](docs/adr/0003-web-accounts-and-hosted-deployment.md) | Web 账号体系、多租户数据模型与托管部署决策（原 Render，现 Railway） |
| [ADR-0002（提议）](docs/adr/0002-agent-positioning-language-contract.md) | 非临床定位与 Agent 语言契约：MoCA 参考三分法、不借诊断权威 |
| [本地开发与测试](docs/software/local-development.md) | 一键起库与服务、测试矩阵、LLM 联调、手工回归 |
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
├─ Dockerfile / railway.json # Railway 构建（python:3.13-slim）与部署配置
├─ docs/
│  ├─ requirements/        # 问题、功能、非功能、Agent
│  ├─ research/            # 历史调研、用户故事
│  ├─ algorithm/           # 8 项计分
│  ├─ software/            # 技术方案、部署、本地开发、日志
│  │  └─ prototype/        # L1 原型骨架（UI 参考）
│  ├─ adr/                 # 架构决策（0001 桌面、0003 Web 账号与托管）
│  ├─ mgmt/                # 沟通与风险
│  └─ retrospection/
├─ code/
│  ├─ backend/            # FastAPI：auth/账号、API、Agent、RAG、scoring
│  ├─ frontend/           # 原生前端（登录/注册 + 测评 + 报告 + 对话）
│  └─ core_engine/        # L1 JS 计分历史
├─ scripts/                # 门禁、本地一键起服、冒烟检查、纯逻辑测试
├─ tests/                  # backend（pytest）/ e2e（Playwright）/ ai_eval（评测集）
├─ work_for_submission/    # 课程提交历史快照
└─ README.md
```

## 本期范围

**当前做**：Web 托管、账号注册/登录/注销、标准 4 项与深度 8 项、服务端计分、八维报告、Agent（站点 LLM API）、按账号的记忆/RAG/趋势、导出/清除。

**下一步**：邮件验证与密码找回（若要对外开放注册）、练习模式与 ASR、评测集与告警、向量检索上线路径。

**不做**：常模、百分位、总分、诊断、7 天计划/打卡、情绪支持、B 端、付费、社区、原生 App、多语言、K8s/Redis/Milvus。

## 当前状态

- 当前实现为 **Web 托管版**：FastAPI + PostgreSQL/pgvector + Alembic + LangGraph，前端与 API 同源；
- 桌面本地版（pywebview + 便携 PostgreSQL + keyring）已被 [ADR-0003](docs/adr/0003-web-accounts-and-hosted-deployment.md) 取代，入口脚本仅作历史保留；
- 账号 = 用户名 + 密码（不收集邮箱/手机号）；会话是服务端会话表 + HttpOnly Cookie，不是 JWT；
- LLM Key 只在服务端环境变量（`MM_LLM_API_KEY`），不进前端、数据库、日志与导出；未配置时统一走模板兜底；
- 迁移 `0004_hosted_copy` 会拒绝在旧桌面库上运行：多租户需要全新数据库；
- 课程提交版只作历史快照，不代表当前口径。

## 开发与测试

```powershell
# 首次：
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
# 或手动：python -m pip install -r requirements-dev.txt && npm ci && scripts/fetch_pgsql.ps1

npm run check          # ESLint + Prettier + 前端/纯逻辑测试（含账号与传输层用例）
npm run complexity     # 复杂度报告（warn，不阻塞）
npm run test:e2e       # Playwright：自建便携 PostgreSQL + 真实登录/注册流

python scripts/check_docs.py
python scripts/check_secrets.py
python scripts/export_issues.py --check

# 后端测试（需要 pgvector Postgres；设 MM_TEST_DATABASE_URL 后）
$env:MM_TEST_DATABASE_URL = "postgresql+psycopg://mm_test@127.0.0.1:55450/mindmeter_test"
pytest -q tests/backend -rs

# 本地跑 Web 版（一条命令：自建数据库 + 迁移 + 服务在 :8100）
python scripts/e2e_server.py
python scripts/smoke_web_deploy.py http://127.0.0.1:8100   # 部署后冒烟检查

# 用外部 Postgres 起开发服
cd code/backend
$env:MM_DATABASE_URL = "postgresql+psycopg://user:pass@127.0.0.1:5432/mindmeter"
$env:MM_LLM_API_KEY = "sk-..."           # 不填就走模板兜底
python -m uvicorn app.main:app --reload --port 8000
```

- 部署：见 [docs/software/deploy-railway.md](docs/software/deploy-railway.md)（Railway，合入 main 自动部署）；
- 本地开发与测试矩阵：见 [docs/software/local-development.md](docs/software/local-development.md)；
- CI：`.github/workflows/ci.yml`（Node 24 lint/format/前端测试；pgvector 服务上的后端契约与浏览器 E2E；secret scan）；
- 文档/结构：`.github/workflows/structure-check.yml`；
- 测试说明：[tests/README.md](tests/README.md)。

后端测试在没有 `MM_TEST_DATABASE_URL` 时自动跳过需要数据库的用例；`code/backend/app/main.py` 缺失则直接失败，不静默跳过。

## 原则

- 先纵向切片，再铺功能；
- Agent 出错只能错措辞，不能错分数/结论/建议；
- 不伪造常模、百分位、效度、误差；
- 不设总分，避免把不同结构的人压成一个数字；
- 不收集姓名/手机号等身份信息；对话只留最近 20 条 + 摘要；
- AI 默认有模板兜底；模型 Key 只存在于服务端环境变量，不写日志、不进导出、不给浏览器。
