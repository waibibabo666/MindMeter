# MindMeter 部署到 Render（Web 应用 + 账号 + 站点统一 LLM）

> 目标：把课程项目变成一条链接就能用的标准 Web 应用。
> 决策依据见 [ADR-0003](../adr/0003-web-accounts-and-hosted-deployment.md)。

## 0. 先看结论

| 项目 | 值 |
| --- | --- |
| 服务类型 | Render **Web Service**（Python/FastAPI，同源托管前端静态文件，不需要单独前端服务） |
| 数据库 | Render **PostgreSQL 17 + pgvector**（Blueprint 里 `extensions: [vector]`） |
| 迁移 | 部署时 `alembic upgrade head`（`preDeployCommand`）；启动时也会自动补一次（`MM_AUTO_MIGRATE=1`） |
| 探活 | `/api/v1/health/live`（不依赖 DB）；就绪检查 `/api/v1/health` |
| 账号 | 用户名 + 密码，PBKDF2-SHA256；HttpOnly + SameSite=Lax Cookie 会话，30 天滑动续期 |
| AI | 站点级环境变量 `MM_LLM_*`（OpenAI 兼容 `/chat/completions`），**Key 只在服务端** |
| 默认档位 | Free（可一键升 `starter`，见 §6） |

## 1. 推荐做法：Blueprint 一键部署

1. 把仓库推到 GitHub（`main` 分支）。
2. Render → **New → Blueprint** → 选这个仓库。
3. 在确认页填一个值：**`MM_LLM_API_KEY`**（其余环境变量都来自 `render.yaml`）。
4. 等首次 Build + Deploy 完成（约 3–6 分钟，含建库与迁移）。
5. 打开 `https://<service>.onrender.com/`，注册一个账号即可。

`render.yaml` 里同时声明了 web 服务与 Postgres，Render 会自动把内网连接串注入 `MM_DATABASE_URL`（`fromDatabase: connectionString`），无需手填密码。

### 手动部署（不用 Blueprint 时的等价配置）

1. 先 **New → PostgreSQL**：名字 `mindmeter-db`，版本 17，在 Extensions 里勾上 `vector`（已建好的库没有 pgvector 就新建一个库）。
2. **New → Web Service**，连同一仓库，配置：

| 字段 | 值 |
| --- | --- |
| Runtime | Python 3.13（仓库有 `.python-version`） |
| Build command | `python -m pip install -r requirements.txt` |
| Start command | `cd code/backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips "*"` |
| Health check path | `/api/v1/health/live` |

3. Environment 里加 §4 的表；`MM_DATABASE_URL` 直接用 Internal connection string（内网免 TLS、免流量）。

> `--proxy-headers --forwarded-allow-ips "*"` 是必须的：Render 在前方终止 TLS，加上这两个参数后 `X-Forwarded-Proto=https` 才会被识别，会话 Cookie 才会带上 `Secure`。

## 2. 站点用哪个大模型（你只需要填 Base URL + 模型名 + Key）

后端只要求 **OpenAI 兼容的 `POST {base}/chat/completions`**，输出 ≤800 token 的中文解读。本项目对模型的要求很低：中文通顺、听话（不编数字、不越界措辞）、首字延迟别太高。校验层（`app/agent`）会拒绝越界表述并自动回退模板，所以**不需要买贵的旗舰模型**。

| 选项 | `MM_LLM_BASE_URL` | `MM_LLM_MODEL` | 成本 | 备注 |
| --- | --- | --- | --- | --- |
| **智谱 GLM-4-Flash-250414（默认，0 元）** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash-250414` | 免费 | 2026-11-20 实测秒回。**同账号下 `glm-4.7-flash` 高峰期返回 HTTP 429 / code 1305「该模型当前访问量过大」**，因此 4.7-flash 只作为备用链末位；`glm-z1-flash` 会把 `<think>` 写进 content，不要用 |
| DeepSeek V4-Flash | `https://api.deepseek.com/v1` | `deepseek-v4-flash`（旧名 `deepseek-chat` 仍在兼容期） | 极低（输入约 ¥3/百万 tokens、输出约 ¥6/百万，缓存命中更低） | 中文稳、延迟低；`deepseek-chat` 官方标注日后弃用 |
| 阿里百炼 / 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` 或 `qwen-plus` | 新用户有免费额度（以控制台到账为准），之后按量 | 国内直连稳定，OpenAI 兼容接口 |
| OpenRouter（聚合） | `https://openrouter.ai/api/v1` | 例如 `deepseek/deepseek-chat` | 按所选模型 | 一个 Key 换模型；计费与限速看上游 |

价格与免费额度会变动，**上线前自己核一遍控制台**；上面的表是选型入口，不是承诺。

选好后只需要三个环境变量：`MM_LLM_BASE_URL`、`MM_LLM_MODEL`、`MM_LLM_API_KEY`。
在 `MM_LLM_API_KEY` 为空时应用**照常可用**：AI 解读走模板（`ai.enabled=false`，报告与对话给出 `code=not_configured` 的模板文本）。这一点在冒烟测试里已验证。

### 免费池过载时怎么办（2026-11-20 实测加入）

免费模型是共享容量，高峰期会直接 429。后端不再"一次 429 就退回模板"，而是：

1. 同一模型最多重试 `MM_LLM_RETRIES` 次，指数退避（`1.2s → 2.4s`）；
2. 仍失败就按 `MM_LLM_MODEL_FALLBACKS` 顺序换下一个模型；
3. 全链失败才回退模板，`/settings/ai/test` 会返回 `tried: [...]` 告诉你试过哪些。

本地调试时 `python scripts/dev_serve.py restart` 后，启动行会直接打印
`AI：真实模型已生效 · model=<实际应答的模型>`，不用猜配置有没有生效。
另外：`.env.local` 改动后必须重启才生效——`dev_serve` 现在会**自动检测配置文件指纹并重启**，
`start` 也能识别"进程比配置早启动"的情况。

## 3. 知识库检索（RAG）模式

- 部署默认 `MM_RAG_MODE=keyword`：用 `kb_chunks` 里的 30 条已审知识块做字符二元 BM25 检索，零依赖、冷启动快。
- 想要语义向量检索：需要 embedding 模型（`fastembed` + `BAAI/bge-small-zh-v1.5`，约 100 MB）。免费实例文件系统是临时的、磁盘配额小，因此**不要把模型下载放进运行时**；真要上向量检索，就改成调用远端 embedding API 或升级到付费实例 + 构建期烘进镜像。
- `pgvector` 扩展本身已开（`/api/v1/health` 会报 `db.pgvector` 版本），列也在，随时可用。

## 4. 环境变量清单（前缀 `MM_`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MM_DATABASE_URL` | — | 由 Blueprint 注入。接受 `postgres://`、`postgresql://`、`postgresql+psycopg://`，内部会归一为 psycopg3 驱动 |
| `MM_LLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 Base URL（可含或不含 `/chat/completions`） |
| `MM_LLM_MODEL` | `glm-4.7-flash` | 模型名 |
| `MM_LLM_API_KEY` | 空 | **只在服务端**；空值 = 模板兜底 |
| `MM_LLM_MODEL_FALLBACKS` | `glm-4-air-250414,glm-4.5-flash,glm-4.7-flash` | 过载时按顺序降级的备用模型（逗号分隔） |
| `MM_LLM_RETRIES` / `MM_LLM_RETRY_BACKOFF_S` | `2` / `1.2` | 同一模型的退避重试次数与基数（指数） |
| `MM_LLM_EXTRA_PARAMS` | 空 | 网关专属 JSON 参数；留空时按域名自动判断（智谱自动发 `thinking:{type:disabled}`） |
| `MM_LLM_TIMEOUT_S` | `45` | 单次模型请求超时 |
| `MM_LLM_MAX_TOKENS` | `800` | 对话输出上限（报告解读为 3000） |
| `MM_ALLOW_REGISTRATION` | `true` | 设 `false` 关闭自助注册（答辩控量用） |
| `MM_SESSION_TTL_DAYS` | `30` | 会话有效期（滑动续期） |
| `MM_COOKIE_SECURE` | `auto` | `auto` 按 `X-Forwarded-Proto` 决定是否 `Secure` |
| `MM_LOGIN_MAX_ATTEMPTS` / `MM_LOGIN_WINDOW_S` | `10` / `300` | 登录限流：`IP + 用户名` |
| `MM_REGISTER_MAX_ATTEMPTS` / `MM_REGISTER_WINDOW_S` | `50` / `3600` | 注册限流：`IP`（校园/酒店 NAT 是同一个出口 IP，故给得宽松） |
| `MM_RAG_MODE` | `keyword` | `keyword` / `auto` / `vector` |
| `MM_DATA_DIR` | `/tmp/mindmeter`（Render 上） | 日志目录；文件系统临时，只做缓冲 |
| `MM_AUTO_MIGRATE` | `1` | 启动时跑一次 `alembic upgrade head` |
| `MM_EXPOSE_LOGS` | `false` | `true` 才把服务端日志尾部给已登录用户看（多用户站默认关） |

`PORT`、`RENDER` 由平台注入；`RENDER=1` 时日志同时走 stdout（Render 日志页可见）。

## 5. 验收清单

### 5.0 合并与上线前体检（每条都验证过，可复查）

| 检查项 | 结论 | 怎么自己复核 |
| --- | --- | --- |
| 模型 Key 会不会被提交 | **不会**。`.env.local` 未被跟踪，被 `.gitignore` 的 `.env.*` 拦住 | `git ls-files --error-unmatch .env.local` 应报错；`git check-ignore -v .env.local` 应命中 |
| Render 用哪个 Python | **3.13**（根目录 `.python-version`，可省略补丁号，Render 自动取最新补丁） | `git ls-files .python-version` |
| CI 测的是不是部署版本 | **是**，三个 job 都 pin 3.13，与 `.python-version` 一致 | `Select-String .github\workflows\ci.yml -Pattern python-version` |
| CI 后端测试会不会静默跳过 | **不会**，backend job 设了 `MM_TEST_DATABASE_URL` 且服务镜像是 `pgvector/pgvector:pg17` | 看 CI 日志里 pytest 的通过数（应为全量，不是 skipped） |
| 大体积/二进制有没有进仓库 | **没有**：`vendor/`、`node_modules/`、`runtime/`、验证截图 `after-*.png` 全部忽略 | `git ls-files \| Measure-Object`（约 242） |
| `startCommand` 里的 `"*"` 会不会出问题 | **线上不会**（Render 用 `sh -c`，双引号内不展开）；Windows 手工复制会炸，见 §5.1 注 | 本地复现：`uvicorn … --forwarded-allow-ips "*"` |
| develop → main 能不能快进 | **不能**，`origin/main` 有 2 个提交不在 develop 里（`389c209 测试脚本`、`1b27f79 Merge PR#24`）；但 `git merge-tree` 预演**无冲突**，正常 merge 即可 | `git merge-base --is-ancestor origin/main develop` |

> 注意 `389c209` 是直接提交到 main、从未回流 develop 的。合并后 main 会保留它的内容，
> 但 develop 分支上看不到 —— 建议合并完把 main 反向并回 develop，避免两条线长期分叉。

### 5.1 部署前：用生产参数本地预检（推荐先跑这个）

```powershell
python scripts/check_prod_runtime.py
```

它**不是**跑现有 dev 服务，而是用与 `render.yaml` 一致的环境变量（`MM_AUTO_MIGRATE=1`、
`MM_EXPOSE_LOGS=false`、`MM_COOKIE_SECURE=auto`、`MM_RAG_MODE=keyword`、`MM_DATA_DIR=/tmp` 等价路径）
另起一个 uvicorn 进程，把关键链路真跑一遍：liveness/readiness、Cookie 属性、
`/logs` 是否按开关拒绝、服务端计分、报告解读是否走模型、对话是否沉淀记忆、
**两种清除语义**（`DELETE /memory/messages` 只清对话 vs `DELETE /memory` 清全部四类）、
同源静态页与模块可达。期望 **11/11**。

> 一个必须知道的本地差异：这个脚本刻意**不传** `--forwarded-allow-ips "*"`。
> Windows 的 C 运行时会在当前目录展开裸 `*`，uvicorn 收到多余位置参数直接退出
> （`Error: Got unexpected extra arguments (alembic.ini app pyproject.toml …)`）；
> Render 用 `sh -c "<startCommand>"` 执行，双引号内的 `*` 不会被展开，**线上那条命令是安全的**。
> 如果你在 Windows 上手工复制 startCommand 调试，请把 `*` 换成具体 IP 或 `127.0.0.1`。

### 5.2 部署后：冒烟检查

本地或线上都可以跑同一条命令（它会注册临时账号、验证隔离、导出、注销，最后自己清理）：

```powershell
python scripts/smoke_web_deploy.py https://<service>.onrender.com
```

期望 **22/22** 全绿，覆盖：liveness/readiness、静态页与安全头、注册 Cookie 属性、会话探测、匿名 401、
跨源写拒绝、服务端计分（含**分档题量**：标准档 nc/ir/ni 不得为 null）、报告解读（模型或模板兜底）、
**配了 Key 时解读必须来自模型**、`settings/ai/test` 必须成功、对话、导出无密钥、
**另一账号读不到（404）**、AI 设置只读、`PUT /settings/ai` 403、登出、注销后再登录失败。

手工回归（3 分钟）：

- [ ] 注册 → 标准 8 项 → 报告 → 对话 → 记忆 → 趋势全链路；
- [ ] 刷新页面进度还在；换浏览器登录后数据也在（账号级）；
- [ ] 设置页显示“模型由站点统一提供”，看不到任何 Key 输入框；
- [ ] 导出 JSON 里没有 `sk-` 开头的字符串；
- [ ] 注销账号后同一用户名可重新注册，且是空数据；
- [ ] `/api/v1/health` 的 `migration` 是 `0004_hosted_copy`、`rag.chunks=30`。

测试：`npm run check`（前端/纯逻辑）、`pytest -q tests/backend`（需 `MM_TEST_DATABASE_URL`）、`npm run test:e2e`（Playwright + 本地便携 PostgreSQL，脚本已改成自建 trust 集群）。

## 6. 免费层要心里有数，以及怎么升级

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 首个请求 30–60 秒 | Free 实例 15 分钟空闲后休眠 | 答辩前先点一次；或升 `starter` |
| 重启后本地文件丢失 | 文件系统临时 | 业务数据全在 Postgres；日志走 stdout；`MM_DATA_DIR=/tmp/mindmeter` |
| 免费 Postgres **30 天后过期** | Free 数据库策略 | 演示长期保留就把 `databases.plan` 改 `starter`；或定期 `pg_dump` 备份 |
| 中国大陆访问慢/不稳 | `*.onrender.com` 在部分地区可达性差 | 把 `region` 改成 `singapore` / `frankfurt` 试；重要场合用国内服务器或 CDN 回源 |
| 并发上来变慢 | 0.1 CPU + 小连接池 | 升 `starter`；连接池在 `app/db.py`（`pool_size=3 + max_overflow=3`） |

一行升级：把 `render.yaml` 里 `plan: free` 改成 `plan: starter`（web 与 db 各一处），Blueprint 会 Update。

## 7. 故障排查

| 症状 | 先查 | 说明 |
| --- | --- | --- |
| 部署时 `migration ... failed` 或 `/api/v1/health` 一直 503 | Render Postgres 是否开了 `vector` 扩展 | 迁移 0001 会执行 `CREATE EXTENSION IF NOT EXISTS vector`；库属主无权时请在 Dashboard 勾选扩展或换实例 |
| `Invalid URL` / 连不上数据库 | 用了 External connection string | 内网串才免 TLS；用外网串需带 `?sslmode=require` |
| 登录后立刻 401 / Cookie 丢失 | Start command 是否带 `--proxy-headers --forwarded-allow-ips "*"` | 没有它 Cookie 可能带上/丢掉 `Secure`，或 `SameSite` 判定异常 |
| 报告解读全是模板 | `/api/v1/health` 的 `ai.enabled` | `false` = 没填或填错 `MM_LLM_API_KEY`；设置页「测试连接」会给具体错误码 |
| `auth` 接口 429 | 限流计数在内存 | 单实例有效；换 IP 或等窗口过去；不是分布式限流 |
| 想临时禁止注册 | 环境变量 | `MM_ALLOW_REGISTRATION=false`，重启生效 |
| 老桌面库跑不起来 | 架构已换 | Web 需要全新库；`0004_hosted_copy` 会明确报错并提示重建 |
| Windows 本地跑测试脚本报 `InvalidURL: invalid port` | `NO_PROXY` 里有 `[::1]` | 已知 httpx 0.28 问题，后端与冒烟脚本都已清洗 |

## 8. 上线后建议立刻做的三件事

1. **备份**：付费实例开每日备份；免费实例至少手动 `pg_dump` 一份留课程归档。
2. **关闭自助注册**（如果只给评委/同学用）：`MM_ALLOW_REGISTRATION=false`，手动建几个账号。
3. **看一次日志**：Render → Logs，确认没有把提示词、Key 写进日志（`logging_setup.py` 会脱敏，但值得抽查）。

## 9. 仓库里与部署相关的文件

- [`render.yaml`](../../render.yaml)：Blueprint（web + Postgres + 环境变量 + 探活 + 迁移）
- [`requirements.txt`](../../requirements.txt)：Web 运行时依赖（已去掉 pywebview/keyring/fastembed）
- [`.python-version`](../../.python-version)：3.13
- [`docs/software/local-development.md`](local-development.md)：本地起服务与测试矩阵（部署前在本地跑同一套）
- [`scripts/smoke_web_deploy.py`](../../scripts/smoke_web_deploy.py)：部署后冒烟检查
- [`scripts/check_prod_runtime.py`](../../scripts/check_prod_runtime.py)：部署前用生产参数本地预检
- [`scripts/e2e_server.py`](../../scripts/e2e_server.py)：本地一键起库/服务（`--db-only`、`--stop`）
- [`scripts/check_frontend_dead_code.py`](../../scripts/check_frontend_dead_code.py)：前端不可达模块检查（防止桌面 legacy 回流）
- [`docs/adr/0003-web-accounts-and-hosted-deployment.md`](../adr/0003-web-accounts-and-hosted-deployment.md)：账号与部署决策
- [`code/backend/app/auth.py`](../../code/backend/app/auth.py)：口令与会话实现
