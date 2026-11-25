# 本地开发与测试（Web 版）

> 部署到 Railway 见 [deploy-railway.md](deploy-railway.md)；账号与多租户的设计取舍见 [ADR-0003](../adr/0003-web-accounts-and-hosted-deployment.md)。
> 桌面版（pywebview / `MindMeter.cmd` / keyring）已删除，本文是唯一入口。

## 1. 一次性准备

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
# 等价于：pip install -r requirements-dev.txt && npm ci && scripts/fetch_pgsql.ps1
```

需要 Node 24+、Python 3.12+。`fetch_pgsql.ps1` 只为本地一键起库/E2E 下载便携 PostgreSQL + pgvector；线上用 Railway 的 pgvector 模板，不需要它。

## 2. 三种起法

### A. 一键全起（推荐日常开发）

```powershell
python scripts/dev_serve.py start --port 8000
# 浏览器打开 http://127.0.0.1:8000 → 注册一个账号即可用

python scripts/dev_serve.py status   # 库/服务的 pid 与 url
python scripts/dev_serve.py logs     # 看服务端日志尾部
python scripts/dev_serve.py stop     # 停服务并停库
```

它做四件事：初始化 `runtime/e2e` 的一次性集群（仅回环、trust 认证）→ 建库 → `alembic upgrade head` → 起 uvicorn。

**为什么用 `dev_serve` 而不是 `e2e_server`**：`e2e_server.py` 是前台进程（Playwright 的 webServer 用它），关掉终端/作业就没了；`dev_serve.py` 把进程脱离作业树，人工测试期间一直在线。分离进程**不能用 `--reload`**（uvicorn 的 reloader 在无控制台的分离进程里会抛 `WinError 6`，留下一个跑旧代码的 worker）——改了后端就 `stop` 再 `start`。

想让站点用真实模型：把三个变量放进仓库根目录的 `.env.local`（已在 .gitignore 内），`dev_serve start` 会自动读取：

```powershell
# .env.local
MM_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v1  # 注意是 /v4 还是 /v1 看厂商文档
MM_LLM_MODEL=glm-4.7-flash
MM_LLM_API_KEY=sk-xxxx
```

没有 `.env.local` 也能跑：AI 一律走模板兜底，`/api/v1/health` 里 `ai.enabled=false`。

### B. 只起一个测试库（跑 pytest / 用别的数据库）

```powershell
python scripts/e2e_server.py --db-only
# 输出： MM_TEST_DATABASE_URL=postgresql+psycopg://mm_e2e@127.0.0.1:55451/mindmeter_e2e

$env:MM_TEST_DATABASE_URL = "postgresql+psycopg://mm_e2e@127.0.0.1:55451/mindmeter_e2e"
python -m pytest -q tests/unit tests/integration -rs
```

### C. 外部 Postgres + 热重载（不用便携版）

```powershell
# 1) 建库并开扩展（库属主需有权限）
createdb mindmeter_dev
psql -d mindmeter_dev -c "CREATE EXTENSION IF NOT EXISTS vector"

# 2) 迁移 + 起服务
$env:MM_DATABASE_URL = "postgresql+psycopg://user:pass@127.0.0.1:5432/mindmeter_dev"
python -m alembic -c code/backend/alembic.ini upgrade head
cd code/backend
$env:MM_AUTO_MIGRATE = "0"        # 已经手工迁移过，避免每次 reload 再跑一遍
$env:MM_LLM_API_KEY = "sk-..."    # 不填也能跑，AI 走模板兜底
python -m uvicorn app.main:app --reload --port 8000
```

本地 HTTP 下 Cookie 不带 `Secure`（`MM_COOKIE_SECURE=auto` 会按 `X-Forwarded-Proto` 判断），所以 `--reload` 与 `127.0.0.1` 都能正常登录；线上经 Railway 反代后会自动加上。

## 3. 改哪儿跑什么

| 你改了什么 | 必须跑 | 命令 |
| --- | --- | --- |
| 前端 JS/CSS/HTML | lint + 格式 + 纯逻辑 | `npm run check` |
| 认证/路由闸门/页面结构 | 同上 + 浏览器 E2E | `npm run check && npm run test:e2e` |
| 后端 API、模型、迁移 | 后端契约测试 | `python -m pytest -q tests/unit tests/integration -rs`（需要 `MM_TEST_DATABASE_URL`） |
| 数据模型 / 加表 | 迁移真跑一遍 + 契约测试 | `--db-only` 后 `alembic upgrade head`，再 pytest |
| Agent / LLM 调用 / 校验 | 图级测试（不需要真 Key） | `python -m pytest -q tests/unit/test_agent_workflow.py` |
| 知识库内容 | KB 校验 + 种子一致性 | `npm run test:kb && node scripts/export_kb_seed.mjs` |
| 部署物料（Dockerfile/railway.json/依赖/env） | 部署后冒烟 | `python scripts/smoke_web_deploy.py <url>` |
| 文档/结构/密钥 | 三个门禁脚本 | `python scripts/check_docs.py`、`python scripts/check_secrets.py`、`python scripts/check_frontend_dead_code.py` |

预期：`npm run check` 12 套全绿；`pytest` 有库 90 passed、无库 51 passed/39 skipped；`smoke_web_deploy.py` 19/19。

## 4. LLM 联调（三种状态都要看过）

```powershell
# ① 不填 Key：必须仍然可用，解读走模板
python scripts/e2e_server.py
#   对话/报告解读会出现 code=not_configured，设置页「测试连接」报 not_configured

# ② 填 Key：真实模型生效
$env:MM_LLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
$env:MM_LLM_MODEL = "glm-4.7-flash"
$env:MM_LLM_API_KEY = "<你的 Key>"
python scripts/e2e_server.py
#   看健康检查： GET /api/v1/health → "ai": {"enabled": true, "model": "glm-4.7-flash"}
```

页面侧确认路径：设置 → AI 解读 →「测试连接」→ `连接成功：<模型名>`；再回报告页看解读卡的来源标记（`llm` vs `template`）。
`/api/v1/health` 的 `ai.enabled` 是判断“到底有没有真模型”的最快办法，冒烟脚本也会打印它。

## 5. 手工回归清单（答辩前 5 分钟）

- [ ] 注册（含 18+ 勾选，密码 ≥8 位）→ 选档位 → **「第一次见面」页**（年龄步进器 + 学历 + 两项勾选）→ **「今天的状态」页**（睡眠 + 疲劳分段）→ 标准 8 项 → 报告 → 解读卡 → 对话 → 记忆 → 复测 → 趋势；
- [ ] 刷新页面进度还在；**换浏览器/无痕窗口登录同一账号**：数据仍在，且选完档位**直接进「今天的状态」**，不再问年龄与知情同意（临场的睡眠/疲劳则每次都要重填）；
- [ ] 用第二个账号确认看不到第一个账号的测评（或跑 `test_tenancy.py`）；
- [ ] 设置页导出 JSON → 文本搜 `sk-` 必须为 0 命中；模型卡只显示模型名；
- [ ] 改密码后旧设备掉线；注销账号后同一用户名可重新注册且数据为空；
- [ ] 360px 宽度无横向滚动条（E2E 与截图脚本都断言 `overflow=0`）。

## 6. 重置与数据

```powershell
python scripts/dev_serve.py stop
Remove-Item -Recurse -Force runtime\e2e      # 下一次会重新 initdb，等价于全新站点
```

浏览器侧只有 `mindmeter.games.v2`（游戏练习最佳分）与 `mindmeter.app.*` 音效/UI 偏好这类**设备级**数据留在 localStorage；测评、分数、记忆、对话、进度一律在服务端按账号存。

## 7. 本地与 Railway 的差异（别踩）

| 项 | 本地 | Railway |
| --- | --- | --- |
| Cookie `Secure` | 关（http） | 由 `--proxy-headers` + `X-Forwarded-Proto` 判定为开 |
| 日志 | `runtime/*/logs/backend.log` | stdout（Dashboard Logs 页），文件临时 |
| RAG | 同上，`MM_RAG_MODE=keyword` | 默认 keyword；向量检索需要额外部署 embedding |
| 限流计数 | 进程内内存 | 单实例有效，多实例不共享 |
| 启动方式 | `scripts/e2e_server.py` | `Dockerfile` 的 CMD / `railway.json` |

## 8. 上线前的执行顺序

```powershell
npm run check
python scripts/e2e_server.py --db-only; $env:MM_TEST_DATABASE_URL = "..."   # 用上一条输出
python -m pytest -q tests/unit tests/integration -rs
npm run test:e2e
python scripts/check_docs.py; python scripts/check_secrets.py; python scripts/check_frontend_dead_code.py
git push                          # 合入 main 后 Railway 自动部署
python scripts/smoke_web_deploy.py https://<service>.up.railway.app
```
