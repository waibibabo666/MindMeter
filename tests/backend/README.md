# Backend tests

Use a disposable PostgreSQL/pgvector database; never SQLite.

```powershell
# 终端 1：启动测试用本地数据库/后端（窗口可以不打开）
python -m desktop.launcher --no-window --backend-port 8767 --pg-port 55435

# 终端 2：从 keyring 取本机 DB 口令牌并跑测试
$pw = python -c "import keyring; print(keyring.get_password('MindMeter','pg-app'))"
$env:MM_TEST_DATABASE_URL = "postgresql+psycopg://mm_app:$pw@127.0.0.1:55435/mindmeter"
pytest -q tests/backend -rs
```

Covered:

- `/api/v1/health` token requirement + DB/migration/pgvector status;
- loopback Host / Origin guards;
- OpenAPI surface (no auth/JWT endpoints);
- scoring-v3.1 golden cases ported from JS;
- assessment roundtrip, export without key, memory replace, chat template fallback.

For CI, start `pgvector/pgvector:pg17` and set `MM_TEST_DATABASE_URL`.
