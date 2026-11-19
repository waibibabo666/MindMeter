# Backend（Web FastAPI，多用户）

托管版 FastAPI 服务：同源提供 `/api/v1/*` 与前端静态文件，按账号隔离数据，模型由站点环境变量提供。

```text
code/backend/
├─ app/
│  ├─ main.py              # FastAPI + 静态前端 + 启动迁移/会话清理
│  ├─ api/                 # health/auth/state/assessments/memory/chat/settings/data
│  ├─ auth.py              # PBKDF2 口令、服务端会话表、限流、依赖注入
│  ├─ audit.py             # 只记动作与结果，不记内容
│  ├─ models.py            # 多租户 SQLAlchemy 模型（user_id 复合主键）
│  ├─ scoring/             # scoring-v3.1 Python（唯一权威）
│  ├─ rag/                 # BM25（默认）+ pgvector 向量检索 + embedding ingest
│  ├─ agent/               # LangGraph 小图
│  ├─ llm.py               # OpenAI 兼容客户端 + site_llm_config()
│  ├─ db.py                # 连接串归一（postgres:// → postgresql+psycopg://）与小连接池
│  ├─ security.py          # 安全头/CSP + 同源写请求守卫（不再有 loopback/token）
│  └─ logging_setup.py     # 脱敏日志（托管时同时输出到 stdout）
├─ alembic/                # 0001_initial → 0004_hosted_copy
├─ pyproject.toml
└─ alembic.ini
```

## 运行

```powershell
# 本地开发（需要已存在的 pgvector 数据库）
cd code/backend
$env:MM_DATABASE_URL = "postgresql+psycopg://user:pass@127.0.0.1:5432/mindmeter"
$env:MM_LLM_API_KEY = "sk-..."        # 不填 = 解读走模板
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

部署到 Render 见 [docs/software/deploy-render.md](../../docs/software/deploy-render.md)；`MM_AUTO_MIGRATE=1`（默认）会在启动时补跑一次 `alembic upgrade head`，所以手工建服务也不会漏迁移。

## 约定

- 服务端计分唯一权威；前端只提交原始指标；
- 除 `/api/v1/health*` 与 `/api/v1/auth/{register,login,session}` 外，所有接口都要会话 Cookie（`app.auth.require_user`）；
- **所有业务查询必须带 `user_id`**：新增表就用 `user_pk()` 作复合主键第一列，新增接口就取 `Depends(auth.require_user)`；
- 模型 Key 只在 `MM_LLM_*` 环境变量里：数据库无 `ai_settings` 表，`GET /settings/ai` 只读，`PUT`/`DELETE key` 一律 403 `ai_managed_by_site`；
- 会话是服务端表：登出、改密码、注销账号都会撤销数据库里的会话行；
- 对话每账号只留最近 20 条、测评每账号只留最近 50 次；
- AI 失败一律回退模板，分数与结论不变；
- 日志不记录 prompt/回答/Key；`GET /logs` 需要 `MM_EXPOSE_LOGS=1` 且已登录；
- 测试使用 PostgreSQL，不用 SQLite；口令散列与令牌散列都不落明文。
