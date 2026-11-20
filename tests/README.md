# Tests（Web 托管版）

## 分层

| 目录/类型 | 范围 | 现状 |
| --- | --- | --- |
| `npm run lint` / `npm run format:check` | ESLint + Prettier（scripts + frontend） | 可运行 |
| `npm run complexity` | 圈复杂度/函数长度/嵌套/参数报告 | 可运行（warn） |
| `scripts/check_docs.py` | 必需文件/目录、冲突标记、相对链接、重复文件 | 可运行 |
| `scripts/check_secrets.py` | 疑似 Key/token/私钥/带密码 DB URL | 可运行 |
| `scripts/test_prototype.js` | L1 原型 JS 语法、DOM id、三档流程 | 可运行 |
| `scripts/test_app_shell.js` | 入口、路由、任务逻辑、API client 边界（含同源 Cookie、无 Key 通路） | 可运行 |
| `scripts/test_auth.js` | 用户名/密码规则、错误码文案、`api.js` 传输与 401 广播 | 可运行 |
| `scripts/test_memory.js` | 摘要/画像/建议/消息业务规则 | 可运行 |
| `scripts/test_log.js` | 前端日志脱敏/导出 | 可运行 |
| `tests/backend/` | 账号与会话、多租户隔离、健康/OpenAPI 契约、计分金标准、Agent 工作流 | 需要 PostgreSQL/pgvector |
| `tests/e2e/` | Playwright：注册/登录闸门 + 主链路 + 跨账号隔离 | 可运行；`npm run test:e2e` |
| `scripts/smoke_web_deploy.py` | 对已部署实例的 19 项冒烟检查（Cookie、隔离、导出、只读 AI） | 可运行 |
| `tests/unit/` / `tests/integration/` | 预留 | 后续补充 |
| `tests/ai_eval/` | 30 条 Agent + 20 条 RAG | 后续补充 |

**说明**：桌面时代的历史 oracle（`scripts/test_storage.js`、`test_llm_client.js`、`test_agent_run.js`、
`test_eval.js`）以及它们测试的前端 legacy 模块（`src/llm/*`、`src/agent/*`）已在 2026-11-20 删除；
Agent 行为回归改由 `tests/backend/test_agent_chat.py` / `test_agent_workflow.py` 承担，
评测用例集在 `tests/ai_eval/agent-cases.json`。`scripts/check_frontend_dead_code.py` 会持续挡住不可达模块回流。

## 本地命令

```bash
npm ci
npm run check          # ESLint + Prettier + 前端/纯逻辑测试（含 auth）
npm run test:e2e       # Playwright Chromium：自建便携 PostgreSQL + 真实登录流

python scripts/check_docs.py
python scripts/check_secrets.py
python scripts/export_issues.py --check

# 后端测试：需要一个已迁移的 pgvector 数据库
python -m alembic -c code/backend/alembic.ini upgrade head
MM_TEST_DATABASE_URL=postgresql+psycopg://user:pass@127.0.0.1:5432/mindmeter pytest -q tests/backend -rs

# 冒烟：对本地或线上实例
python scripts/e2e_server.py                  # 本地起一条完整服务在 :8100
python scripts/smoke_web_deploy.py http://127.0.0.1:8100
```

Windows PowerShell 同样适用；Node 24+、Python 3.12+。

## CI

| Workflow | 内容 |
| --- | --- |
| `.github/workflows/structure-check.yml` | 文档/链接/冲突/重复/提交文件/issues.csv 同步 |
| `.github/workflows/ci.yml` | Node 24 lint/format/前端测试、pgvector 服务上的后端契约与浏览器 E2E、secret scan |

后端 job 在 `code/backend/pyproject.toml` 出现前会跳过，并输出 notice；出现后如果缺 `app/main.py` 会直接失败，不会静默跳过。
没有 `MM_TEST_DATABASE_URL` 时，需要数据库的用例自动 skip，纯逻辑用例照常跑。

## 测试数据

- 只用合成数据，不提交真实用户作答/对话；测试账号每次运行现注册，跑完注销；
- 固定输入/期望输出；计分金标准用例；
- AI 评测集固定版本，改动需评审；
- 明确断言：不产生总分/均分/百分位；未测维度为 `null`；
- 任何测试与夹具都不出现真实 API Key（假 Key 一律 `sk-test*` 形态且不落盘）。

## 验收底线

- 注册→登录→标准 4 项→报告→对话→记忆→复测→趋势跑通；
- 服务端计分与金标准一致；同账号重复提交幂等；
- 两个账号互不可见：同一 `id` 可各自存在，越权读取 404/401；
- 无总分/常模/百分位；未测显示“未测”；
- AI 失败回退模板；禁用词 0；幻觉数字 0；
- 密码散列不可逆、会话令牌只存散列、导出不含 Key；
- 注销账号即时级联删除（无 30 天缓冲期；平台备份能力不作为数据保留承诺）。
