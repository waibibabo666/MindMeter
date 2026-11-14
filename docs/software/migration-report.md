# M1 → 桌面本地版迁移报告

日期：2026-11-14  
范围：架构迁移，不改 UI 视觉设计。

## 保留

| 内容 | 说明 |
| --- | --- |
| 所有页面/路由/任务/雷达/趋势 UI | `index.html`、`styles/app.css`、`ui.js`、`tasks/*`、`pages/*` 的 DOM/CSS 不变 |
| 计分公式 | `scoring-v3.1` 的 8 维公式与阈值，移植到 Python，JS 版保留为对照 |
| 30 条知识块 | 内容、来源、审核状态不变；seed 到 `kb_chunks` |
| 模板兜底话术 | 报告/对话在无 Key、超时、校验失败时仍返回模板 |
| 旧导出 JSON 结构 | `schemaVersion/sessions/draft/settings/memory/app` 兼容导入 |
| 纯函数测试中仍适用的部分 | 任务逻辑、路由、雷达、趋势、日志、KB 校验 |

## 重写

| 内容 | 旧 | 新 |
| --- | --- | --- |
| 数据层 | `storage.js` + localStorage | `storage.js` 内存缓存 + `/api/v1` |
| App 状态 | `store.js` localStorage | 内存缓存 + `PUT /state` |
| 计分 | 浏览器 `scoring/*` | `code/backend/app/scoring/`（唯一权威） |
| LLM 调用 | `llm/client.js` 浏览器直连 | `code/backend/app/llm.py` |
| Agent | `agent/run.js` 本地状态机 | `code/backend/app/agent` LangGraph |
| RAG | `kb/search.js` BM25 | pgvector + BM25 混合 |
| 设置 Key | localStorage `apiKey` | keyring + `hasKey`/`keyHint` |
| 后端契约测试 | auth/JWT 路径 | 本地无账号 API |
| E2E | `python -m http.server` + localStorage seed | 真实 FastAPI + PostgreSQL + API seed |

## 删除/不再使用

- localStorage 业务数据持久化（尤其 Key）；
- 浏览器直连 LLM 的生产路径；
- `users`/JWT/auth/refresh 表与接口；
- SQLite 过渡方案（未引入）；
- 旧 `m1_scope.md` 的“不做后端”范围（由 ADR-0001 取代）。

## 新增

- `code/desktop/launcher.py`：单实例、便携 PostgreSQL、Alembic、FastAPI、pywebview、Job Object 清理；
- `vendor/` 便携 PostgreSQL 17.12 + pgvector 0.8.6（gitignored）；
- `code/backend/app`：FastAPI、SQLAlchemy、Alembic、pgvector、LangGraph；
- `MindMeter.cmd` / `MindMeter.vbs` 双击入口；
- keyring-only Key 存储；
- 旧数据导入（自动 `pg_dump` 备份，忽略 `apiKey`）。

## 测试结果

| 命令 | 结果 |
| --- | --- |
| `npm run check` | 通过（lint + format + 前端/纯逻辑测试） |
| `pytest -q tests/backend` | 25 passed（需 `MM_TEST_DATABASE_URL`） |
| `npm run test:e2e` | 4 passed（真实 PostgreSQL + FastAPI） |
| `python scripts/check_docs.py` | 通过 |
| `python scripts/check_secrets.py` | 通过 |
| 双击 `MindMeter.cmd` | 窗口打开；首次 initdb；二次复用；关闭后无 postgres/uvicorn 残留 |

## 已知限制

- 首次启动需要下载/解压便携 PostgreSQL 与 pgvector；仓库不提交二进制。
- 首次 embedding 需要模型缓存；无模型时 `rag_mode=keyword`，功能仍可用。
- 当前没有独立安装包（Phase 6）；入口是仓库内 `.cmd`/`.vbs`，依赖本机 Python 与已安装依赖。
- 旧浏览器 localStorage 不能自动读取，需先在旧版导出 JSON，再在新版设置页导入。
- legacy `llm/client.js`、`agent/run.js`、`scripts/test_storage.js` 等保留为对照，不进入生产路径与 `npm run check`。
