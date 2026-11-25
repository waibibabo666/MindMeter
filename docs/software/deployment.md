# 系统部署

> 本文是部署总览。两条具体路径分别见
> [Railway 部署](deploy-railway.md) 与 [自建服务器部署](deploy-selfhost.md)。

## 1. 部署形态

```text
浏览器 ──HTTPS──> 反向代理 ──HTTP──> uvicorn(FastAPI) ──> PostgreSQL + pgvector
                        └─ 同源托管前端静态文件（FastAPI StaticFiles 挂在 "/"）
```

- 单服务同源：`/api/v1/*` 与前端静态文件由同一个 FastAPI 进程提供，无 CORS；
- 数据库：PostgreSQL + **pgvector**（迁移 `0001` 会 `CREATE EXTENSION vector`）；
- 迁移：`MM_AUTO_MIGRATE=1` 启动时自动 `alembic upgrade head`（best-effort）。

## 2. 两条部署路径

| 路径 | 适用 | 文档 |
| --- | --- | --- |
| **Railway**（推荐） | 有公网地址、免运维 | [deploy-railway.md](deploy-railway.md) |
| **自建 Linux**（阿里云/轻量） | 国内访问、数据不出境 | [deploy-selfhost.md](deploy-selfhost.md) |

两条路径使用**同一份** `Dockerfile` 与同一套 `MM_*` 环境变量。

## 3. 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MM_DATABASE_URL` | ✅ | `postgresql+psycopg://…`；Railway 用 `DATABASE_URL_PRIVATE`（内网） |
| `MM_LLM_API_KEY` | ✅（生产） | 站点统一模型 Key；不填则 AI 走模板 |
| `MM_AUTO_MIGRATE` | 建议 `1` | 启动时自动迁移 |
| `MM_LLM_BASE_URL` / `MM_LLM_MODEL` / `MM_LLM_MODEL_FALLBACKS` | 可选 | 默认智谱 GLM |
| `MM_RAG_MODE` | 可选 | 默认 `keyword` |
| `MM_COOKIE_SECURE` | 可选 | HTTPS 下 `auto`/`true` |
| `MM_ALLOW_REGISTRATION` | 可选 | 正式环境建议 `false` |
| `MM_EXPOSE_LOGS` | 可选 | 共享主机保持 `false` |

完整清单见 [deploy-railway.md](deploy-railway.md) §2 与 [deploy-selfhost.md](deploy-selfhost.md) §3。

## 4. 上线验证

```powershell
python scripts/smoke_web_deploy.py https://<你的域名>
```

期望：注册 → 隔离 → 导出无密钥 → AI 走模型 → 注销全链路通过。

```powershell
curl https://<你的域名>/api/v1/health
```

期望：`status=ok`、`db.connected=true`、`db.migration` 为最新迁移、`db.pgvector` 非 null、`ai.enabled=true`。

## 5. 回滚

- Railway：重新部署上一个 commit；
- 自建：`git checkout <上一个 tag/commit>` 后重新 build 起容器；
- 数据库回退需谨慎，优先「代码回滚 + 保留数据库」。

## 6. 当前状态

- 线上示例：`https://mindmeter-web-production.up.railway.app`（Railway + pgvector 模板）；
- 曾遇到的问题与解决（Nixpacks 误判 Node、标准 Postgres 无 pgvector、pre-deploy `exec cd`）已写入 [deploy-railway.md](deploy-railway.md) §4。
