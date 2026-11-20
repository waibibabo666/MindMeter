# 用 Railway 部署（不需要信用卡）

> 为什么写这份：Render 新账号必须绑国际信用卡做 $1 验证，课程团队没人有卡。
> Railway 的 Free 档官方写明 **$0/月含 $1 用量额度、no credit card required**
> （被风控时可用 `railway.com/verify` 连 GitHub 账号免费解锁）。
>
> 与 `deploy-render.md` 的关系：应用侧**零改动**，只是把 `render.yaml` 里自动做的事
> 在 Railway 上手工配一遍。下面每一项都对应 `render.yaml` 里已有的声明。

## 0. 先决定数据库（这一步会决定成败）

Railway **标准 Postgres 镜像不含 pgvector**（Railway 官方指南原话：
"Railway's standard Postgres image does not include pgvector. Deploy the pgvector template instead"）。
我们的迁移第一句就是 `CREATE EXTENSION IF NOT EXISTS vector`（`code/backend/alembic/versions/0001_initial.py:21`），
模型里还有 `Vector(512)` 列 —— 即使 `MM_RAG_MODE=keyword`（默认，不做向量检索），
**建表时也需要 vector 类型存在**，否则迁移直接失败在 `type "vector" does not exist`。

| 方案 | 做法 | 备注 |
| --- | --- | --- |
| A | 删掉标准 Postgres，改用 Railway 的 **pgvector 模板**（`railway.com/deploy/pgvector--pgvector-postgresql`，镜像 `pgvector/pgvector:pg18`） | 用法与标准库一致，仍走内网连接 |
| B | 数据库用 **Supabase**（免费、不要卡、pgvector 内置），Railway 只跑 web 服务 | 走公网 + `sslmode=require`；应用侧解析已验证可用 |

选 B 时记得在 Supabase 里执行一次 `create extension if not exists vector;`
（或在 Database → Extensions 里打开），并用 **pooled** 连接串。

## 1. 建服务

1. Railway → New Project → **Deploy from GitHub repo** → 选 `MindMeter`，分支 **`main`**
   （PR #93 已合并，main 就是最新代码）
2. **Root Directory 留空**（仓库根）。原因：根目录有 `requirements.txt` 供 Nixpacks 装依赖，
   而应用代码在 `code/backend` —— 由启动命令 `cd code/backend` 处理，不要改成
   `code/backend` 作 Root Directory，那样 Nixpacks 找不到 `requirements.txt`。
3. 仓库已带 [`railway.json`](../../railway.json)，构建/启动/健康检查会自动读取：

```json
{
  "deploy": {
    "startCommand": "cd code/backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips \"*\"",
    "healthcheckPath": "/api/v1/health/live",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

> `--proxy-headers` + `--forwarded-allow-ips "*"` 是必须的：Railway 在代理后面，
> 没有它们应用会把所有请求当成来自代理 IP，`MM_COOKIE_SECURE=auto` 也判断不出 https。
> 裸 `*` 在这里安全 —— Railway 用 shell 执行，双引号内不展开
> （Windows 本地手工复制这条命令会炸，那是 CRT 展开，不是命令本身有问题）。

## 2. 环境变量（对照 `render.yaml` 逐条）

| KEY | VALUE | 为什么 |
| --- | --- | --- |
| `MM_DATABASE_URL` | **必须自己加**：变量引用 `${{Postgres.DATABASE_URL}}`（或粘贴 pgvector 服务的内网连接串） | ⚠️ 应用**只读 `MM_DATABASE_URL`，不认 Railway 自动注入的 `DATABASE_URL`**。漏填时 `/health/live` 仍返回 200（它不碰数据库），于是"部署成功但全站 500" |
| `MM_LLM_API_KEY` | 你的智谱 Key | 唯一必须手填的秘密；`sync` 语义在 Railway 不存在，直接填 |
| `MM_AUTO_MIGRATE` | `1` | ⚠️ Railway **没有 pre-deploy 钩子**，`render.yaml` 里的 `preDeployCommand` 在这行不通，只能靠启动时迁移 |
| `MM_LLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 有默认值，可省略；显式写上更清楚 |
| `MM_LLM_MODEL` | `glm-4-flash-250414` | 同上。2026-11-20 实测 `glm-4.7-flash` 免费池常过载（429/1305） |
| `MM_LLM_MODEL_FALLBACKS` | `glm-4-air-250414,glm-4.5-flash,glm-4.7-flash` | 过载时按顺序降级 |
| `MM_RAG_MODE` | `keyword` | 默认值。免费档不必装 embedding 模型，省内存 |
| `MM_DATA_DIR` | `/tmp/mindmeter` | 容器文件系统临时，只放日志缓冲 |
| `MM_EXPOSE_LOGS` | `false` | 多用户站不要把服务端日志暴露出去 |
| `MM_COOKIE_SECURE` | `auto` | 配合 `--proxy-headers` 自动判定 https 下加 `Secure` |

## 3. 部署后必须验的两件事

```powershell
# ① 迁移与数据库是否真的接上（看 db.connected / migration / pgvector）
curl https://<你的服务>.up.railway.app/api/v1/health

# ② 全链路冒烟（注册→隔离→导出无密钥→AI 是否走模型→注销，22 项）
python scripts/smoke_web_deploy.py https://<你的服务>.up.railway.app
```

`/api/v1/health` 期望：`status=ok`、`db.connected=true`、`db.migration=0005_profile`、
`db.pgvector` 有版本号（**这里是 null 就说明库不是 pgvector 版**，回到 §0）、`ai.enabled=true`。

常见失败对照：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 迁移日志 `type "vector" does not exist` | 用了标准 Postgres | 换 pgvector 模板或 Supabase（§0） |
| `db.connected=false` 但服务起来了 | 只填了 `DATABASE_URL` 没填 `MM_DATABASE_URL` | 补 §2 第一行 |
| `connection refused` / 端口不对 | 启动命令没带 `--port $PORT` | 用仓库里的 `railway.json`，别手改 |
| 注册后刷新掉登录 | 没走 `--proxy-headers`，cookie 被判成 http 不安全 | 补 `--proxy-headers --forwarded-allow-ips "*"` |
| AI 回答都是模板 | Key 没填 / 免费池过载 | 看 `/health` 的 `ai.enabled`，再 `POST /settings/ai/test` |

## 4. 免费额度要说清楚的代价

- Free 档是 **$0/月含 $1 用量额度**，额度**不滚存**。常驻服务（24 小时跑着）很可能一个月用超 $1，
  超了会被停服务，而不是扣费 —— 对课程演示的表现就是"链接突然打不开"。
- 省法：**演示当天再启动**，平时在 Railway 里 Stop 该服务（数据在独立 Postgres 卷上不会丢）；
  或者只让它在你需要时运行。
- 想要一直在线就得升级付费档（那就需要卡了）。

## 5. 与 Render 方案的差异一览（免得你以为代码变了）

| 项 | Render（`render.yaml`） | Railway |
| --- | --- | --- |
| 数据库创建 | Blueprint 自动建 PG17 + vector 扩展 | 手工，且**必须选 pgvector 模板** |
| 连接串注入 | `fromDatabase: connectionString` 自动 | 手工加 `MM_DATABASE_URL=${{Postgres.DATABASE_URL}}` |
| 迁移时机 | `preDeployCommand: alembic upgrade head` | 只能 `MM_AUTO_MIGRATE=1` 启动时跑 |
| 健康检查 | `healthCheckPath` | `railway.json` 的 `healthcheckPath` |
| 代码改动 | — | **零** |
