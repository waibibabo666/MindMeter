# Backend（L2）

FastAPI + PostgreSQL/pgvector + LangGraph。当前为 L2 目标结构；M0 先定 API/数据模型，M1 再落代码。

## 计划目录

```text
backend/
├─ app/
│  ├─ main.py
│  ├─ api/              # auth, assessments, reports, threads, memory, settings, health
│  ├─ core/             # config, security, db, crypto, logging
│  ├─ models/           # SQLAlchemy
│  ├─ schemas/          # Pydantic
│  ├─ scoring/          # config.py, formulas.py, engine.py
│  ├─ agent/            # graph.py, state.py, nodes/, prompts.py, validation.py
│  ├─ rag/              # embed.py, retrieve.py, ingest.py
│  └─ memory/           # service.py
├─ alembic/
├─ tests/
├─ Dockerfile
└─ pyproject.toml
```

## 职责

| 模块 | 职责 |
| --- | --- |
| `api/auth` | 邮箱+密码、JWT、refresh、限流 |
| `api/assessments` | 创建/提交/历史/报告/趋势 |
| `api/threads` | 对话创建/消息 |
| `api/memory` | 画像/摘要/建议/删除 |
| `scoring` | 8 维服务端计分（唯一权威） |
| `agent` | LangGraph 图、节点、prompt、校验 |
| `rag` | 知识库 ingest、embedding、检索、引用 |
| `core/crypto` | BYOK Key 加密/解密 |
| `core/db` | SQLAlchemy/Alembic |

## 运行（M1 落地后）

```bash
docker compose up -d db
uvicorn app.main:app --reload
```

具体命令以 M0 的 `pyproject.toml`/Dockerfile 为准。

## 约定

- 服务端计分为唯一权威；前端只提交原始指标；
- BYOK Key 加密存库，不写日志/导出；
- 对话只留最近 20 条 + 摘要；
- AI 失败回退模板；
- 不接 K8s/Redis/Milvus。
