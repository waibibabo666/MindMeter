# Backend（本地 FastAPI）

当前是桌面本地版的 FastAPI 服务：

```text
code/backend/
├─ app/
│  ├─ main.py              # FastAPI + 静态前端 + 本地 token 中间件
│  ├─ api/                 # health/state/assessments/memory/chat/settings/data
│  ├─ models.py            # SQLAlchemy 模型
│  ├─ scoring/             # scoring-v3.1 Python（唯一权威）
│  ├─ rag/                 # pgvector + BM25 + embedding ingest
│  ├─ agent/               # LangGraph 小图
│  ├─ llm.py               # OpenAI 兼容客户端（Key 只在 keyring）
│  ├─ keyring_store.py     # Windows Credential Manager
│  ├─ security.py          # loopback/token/Origin/Host/CSP
│  └─ logging_setup.py     # 脱敏日志
├─ alembic/                # 0001_initial + 0002_seed_kb
├─ pyproject.toml
└─ alembic.ini
```

## 运行

由 `code/desktop/launcher.py` 启动；不要单独 `uvicorn` 启动生产环境，因为 launcher 负责
PostgreSQL、`CREATE EXTENSION vector`、`pg_dump` 和 `alembic upgrade head`。

```powershell
$env:MM_API_TOKEN = "dev-token"
$env:MM_DATABASE_URL = "postgresql+psycopg://mm_app:<pw>@127.0.0.1:55432/mindmeter"
$env:MM_DATA_DIR = "$PWD\runtime\dev-data"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --no-access-log
```

## 约定

- 服务端计分唯一权威；前端只提交原始指标；
- 无账号/JWT；所有 `/api/v1/*` 需要 `X-MM-Token`；
- Key 只存 keyring，`ai_settings` 只存 `key_ref`/`key_hint`；
- 对话只留最近 20 条；
- AI 失败回退模板；
- 日志不记录 prompt/回答/Key；
- 测试使用 PostgreSQL，不用 SQLite。
