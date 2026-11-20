# 用 Railway 部署（不需要信用卡）

> 为什么写这份：Render 新账号必须绑国际信用卡做 $1 验证，课程团队没人有卡。
> Railway 的 Free 档官方写明 **$0/月含 $1 用量额度、no credit card required**
> （被风控时可用 `railway.com/verify` 连 GitHub 账号免费解锁）。
>
> 本文件是**唯一的部署手册**：构建用仓库根目录的 [`Dockerfile`](../../Dockerfile)，
> 部署参数在 [`railway.json`](../../railway.json)。

## 0. 先决定数据库（这一步会决定成败）

Railway **标准 Postgres 镜像不含 pgvector**（Railway 官方指南原话：
"Railway's standard Postgres image does not include pgvector. Deploy the pgvector template instead"）。
我们的迁移第一句就是 `CREATE EXTENSION IF NOT EXISTS vector`（`code/backend/alembic/versions/0001_initial.py:21`），
模型里还有 `Vector(512)` 列 —— 即使 `MM_RAG_MODE=keyword`（默认，不做向量检索），
**建表时也需要 vector 类型存在**，否则迁移直接失败在 `type "vector" does not exist`。

| 方案 | 做法 | 备注 |
| --- | --- | --- |
| A | 删掉标准 Postgres，改用 Railway 的 **pgvector 模板**（`railway.com/deploy/pgvector--pgvector-postgresql`，镜像 `pgvector/pgvector:pg18`） | 推荐；与标准库用法一致，走内网连接 |
| B | 数据库用 **Supabase**（免费、不要卡、pgvector 内置），Railway 只跑 web 服务 | 走公网 + `sslmode=require`；应用侧解析已验证可用 |

选 B 时记得在 Supabase 里执行一次 `create extension if not exists vector;`
（或在 Database → Extensions 里打开），并用 **pooled** 连接串。

## 1. 建服务

1. Railway → New Project → **Deploy from GitHub repo** → 选 `MindMeter`，分支 **`main`**
   （合入 main 的代码会自动触发部署）
2. **Root Directory 留空**（仓库根）。原因：Dockerfile 要先 `COPY requirements.txt`、
   再 `COPY code ./code`，这两个都必须位于构建上下文根目录。不要改成 `code/backend`
   作 Root Directory，否则根目录的 `requirements.txt` 就取不到了。
3. 仓库已带 [`Dockerfile`](../../Dockerfile)，`railway.json` 指定了 `"builder": "DOCKERFILE"`，
   构建/启动/健康检查全部自动读取：

```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "healthcheckPath": "/api/v1/health/live",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

> **为什么用 Dockerfile 而不是 Nixpacks/Railpack**：根目录有 `package.json`（只给本地
> 测试/lint/playwright 用），Nixpacks/Railpack 会把项目误判成 Node、只装 Node 不装 Python，
> 构建时 `python -m pip install -r requirements.txt` 直接 `python: command not found`（exit 127）。
> Dockerfile 用 `python:3.13-slim` 基底，彻底避免这个误判。
> Railway 的规则是：**仓库里有 Dockerfile 就一定用 Dockerfile 构建**，面板里 Builder 选什么都不影响。

> `--proxy-headers` + `--forwarded-allow-ips "*"` 是必须的：Railway 在代理后面，
> 没有它们应用会把所有请求当成来自代理 IP，`MM_COOKIE_SECURE=auto` 也判断不出 https。
> 裸 `*` 在这里安全 —— Railway 用 shell 执行，双引号内不展开
> （Windows 本地手工复制这条命令会炸，那是 CRT 展开，不是命令本身有问题）。

## 2. 环境变量

在 **`mindmeter-web` → Variables** 里逐条加：

| KEY | VALUE | 为什么 |
| --- | --- | --- |
| `MM_DATABASE_URL` | **必须自己加**：引用 pgvector 服务的 **`DATABASE_URL_PRIVATE`**：`${{pgvector.DATABASE_URL_PRIVATE}}` | ⚠️ 应用**只读 `MM_DATABASE_URL`，不认 Railway 自动注入的 `DATABASE_URL`**。漏填时 `/health/live` 仍返回 200（它不碰数据库），于是"部署成功但全站 500" |
| `MM_LLM_API_KEY` | 你的智谱 Key | 唯一必须手填的秘密 |
| `MM_AUTO_MIGRATE` | `1` | 启动时自动 `alembic upgrade head`（best-effort，不阻塞启动） |
| `MM_LLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 有默认值，可省略；显式写上更清楚 |
| `MM_LLM_MODEL` | `glm-4-flash-250414` | 同上。2026-11-20 实测 `glm-4.7-flash` 免费池常过载（429/1305） |
| `MM_LLM_MODEL_FALLBACKS` | `glm-4-air-250414,glm-4.5-flash,glm-4.7-flash` | 过载时按顺序降级 |
| `MM_RAG_MODE` | `keyword` | 默认值。免费档不必装 embedding 模型，省内存 |
| `MM_DATA_DIR` | `/tmp/mindmeter` | 容器文件系统临时，只放日志缓冲 |
| `MM_EXPOSE_LOGS` | `false` | 多用户站不要把服务端日志暴露出去 |
| `MM_COOKIE_SECURE` | `auto` | 配合 `--proxy-headers` 自动判定 https 下加 `Secure` |

### 2.1 连接串一定用 `DATABASE_URL_PRIVATE`

Railway 的 pgvector 模板同时提供：

- `DATABASE_URL` / `PGHOST` → 走 **`RAILWAY_TCP_PROXY_DOMAIN`（公网 TCP 代理）**，会产生 **egress 出网费**；
- `DATABASE_URL_PRIVATE` / `PGHOST_PRIVATE` → 走 **`RAILWAY_PRIVATE_DOMAIN`（内网）**，**免费**。

所以 `MM_DATABASE_URL` 引用 **`${{pgvector.DATABASE_URL_PRIVATE}}`**。
引用 `DATABASE_URL` 时 Railway 会弹黄色提示："This variable references a public endpoint… will incur egress fees"——看到这条就换成 PRIVATE。

### 2.2 Pre-deploy Command（可选；踩过坑）

Railway 服务 **Settings → Deploy → Pre-deploy Command** 是可选项。它**不是必需的**：
应用的 `MM_AUTO_MIGRATE=1` 会在容器启动时自己跑迁移。

如果要保留它做"迁移不过就不放行"的严格门禁，命令必须写成：

```bash
/bin/sh -c "cd code/backend && alembic upgrade head"
```

⚠️ **不要写 `exec cd ...`**：`cd` 是 shell 内建命令，`exec` 找不到可执行文件，
会立即报 `exec: cd: not found`（exit 127），而 Railway 的 Deploy Logs 几乎不显示这条错误，
表现为"Pre deploy command failed（3 秒）"却看不到原因。

## 3. 部署后必须验的两件事

⚠️ **先看日志，别看健康检查。** `app/main.py` 里的 `run_migrations()` 是刻意做成
best-effort 的（注释原话 "Never takes the app down"）：迁移失败只写一行
`auto-migration failed: <异常类型>`，**服务照常启动、`/health/live` 照常 200**。
所以 pgvector 缺失这类问题会伪装成"部署成功"，而 `db.connected` 也是 true
（数据库连得上，只是表没建）—— 只有真正调数据库的接口才会 500。

```powershell
# ① 决定性检查：全链路冒烟（注册→隔离→导出无密钥→AI 是否走模型→注销）
python scripts/smoke_web_deploy.py https://<你的服务>.up.railway.app
```

它第一步就注册账号，表没建会当场失败 —— 比任何健康检查都可靠。

```powershell
# ② 细节确认：迁移版本、pgvector 版本、AI 开关
curl https://<你的服务>.up.railway.app/api/v1/health
```

期望：`status=ok`、`db.connected=true`、**`db.migration=0005_profile`**（说明迁移真跑过了）、
`db.pgvector` 有版本号（**这里是 null 就说明库不是 pgvector 版**，回到 §0）、`ai.enabled=true`。

同时在 Railway 的 Deploy Logs 里搜 `auto-migration failed` —— 出现就是迁移没成。

常见失败对照：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 迁移日志 `type "vector" does not exist` | 用了标准 Postgres | 换 pgvector 模板或 Supabase（§0） |
| `db.connected=false` 但服务起来了 | 只填了 `DATABASE_URL` 没填 `MM_DATABASE_URL` | 补 §2 第一行 |
| `connection refused` / 端口不对 | 启动命令没带 `--port $PORT` | 用仓库里的 `Dockerfile` / `railway.json`，别手改 |
| `Pre deploy command failed`（3 秒、无日志） | 命令写成了 `exec cd ...` | 见 §2.2，去掉 `exec` |
| 注册后刷新掉登录 | 没走 `--proxy-headers`，cookie 被判成 http 不安全 | 补 `--proxy-headers --forwarded-allow-ips "*"` |
| AI 回答都是模板 | Key 没填 / 免费池过载 | 看 `/health` 的 `ai.enabled`，再 `POST /settings/ai/test` |
| Railway 提示引用公网、有 egress 费 | 用了 `DATABASE_URL` | 换成 `DATABASE_URL_PRIVATE`（§2.1） |

## 4. 免费额度要说清楚的代价

- Free 档是 **$0/月含 $1 用量额度**，额度**不滚存**。常驻服务（24 小时跑着）很可能一个月用超 $1，
  超了会被停服务，而不是扣费 —— 对课程演示的表现就是"链接突然打不开"。
- 省法：**演示当天再启动**，平时在 Railway 里 Stop 该服务（数据在独立 Postgres 卷上不会丢）；
  或者只让它在你需要时运行。
- 想要一直在线就得升级付费档（那就需要卡了）。

## 5. 部署形态速览

| 项 | 值 |
| --- | --- |
| 构建 | 根目录 `Dockerfile`（`python:3.13-slim`），`railway.json` 指定 `builder: DOCKERFILE` |
| 启动 | `cd code/backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips "*"` |
| 数据库 | Railway **pgvector 模板**（或 Supabase），连接串用内网 `DATABASE_URL_PRIVATE` |
| 迁移 | `MM_AUTO_MIGRATE=1` 启动时跑；或用 §2.2 的 Pre-deploy Command 做严格门禁 |
| 健康检查 | `/api/v1/health/live`（不碰数据库） |
| 触发 | 合入 `main` 自动部署；`develop` 不影响线上 |
