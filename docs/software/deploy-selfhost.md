# 自建服务器部署（VPS / 阿里云 / 任意 Linux 主机）

本文是[Railway 部署](deploy-railway.md)的替代路径：把同一套服务跑在自己的一台 Linux 机器上。
代码与镜像和 Railway 完全一致（同一份 `Dockerfile`、同一套 `MM_*` 环境变量），区别只在「谁来提供数据库、TLS 和进程守护」。

> 两种部署共用[本地开发](local-development.md)里的测试矩阵；上线前建议先在本地跑通再上服务器。

## 0. 什么时候选自建

| 场景 | 建议 |
| --- | --- |
| 答辩 / 演示，只想有个公网地址 | 用 [Railway](deploy-railway.md)，不用管运维 |
| 需要国内访问速度、数据不出境 | **自建**（阿里云 / 腾讯云轻量，2 核 4 GB 起） |
| 需要自己控制数据库备份与保留期 | **自建** |
| 只想跑几分钟看看 | Railway 更省事 |

自建要多承担三件事：TLS 证书、数据库备份、进程守护。下面都给出现成配置。

## 1. 形态速览

```text
浏览器 ──HTTPS──> nginx(80/443) ──HTTP──> uvicorn(127.0.0.1:8000) ──TCP──> PostgreSQL
                     │                        │
                     │                        └─ 同源托管前端静态文件（StaticFiles 挂在 "/"）
                     └─ 证书、限流、真实 IP
```

关键约束（来自代码，不是建议）：

| 约束 | 出处 | 说明 |
| --- | --- | --- |
| 应用与静态前端**同源** | `main.py` 把 `code/frontend` 挂到 `/` | 不需要 CORS，不需要单独的前端服务 |
| 会话是 **cookie**（`mm_session`，SameSite=Lax） | `security.py` | 反向代理必须让 `Set-Cookie` 原样透传，不能改写域名 |
| CSRF 靠「同源 + JSON」 | `security.py` | 所有改状态的请求必须是同源 JSON；**不要**在前面加会改写 Origin 的网关 |
| `cookie_secure=auto` 依赖 `X-Forwarded-Proto` | `config.py` | 走 HTTPS 时必须让后端看到 `https`，否则 cookie 不会带 Secure |
| 启动自动迁移 | `MM_AUTO_MIGRATE=1`（默认） | 首次启动会跑 `alembic upgrade head`，平台另有迁移步骤时设 `0` |

## 2. 机器与网络

| 项 | 最低 | 推荐 |
| --- | --- | --- |
| CPU | 2 核 | 2 核 |
| 内存 | 2 GB | **4 GB**（PostgreSQL 同机时） |
| 磁盘 | 40 GB | 60 GB |
| 系统 | Ubuntu 22.04 / Debian 12 | 同 |
| 端口 | 22 / 80 / 443 | 同 |

- **不要**把 8000 和 5432 开放到公网。
- 域名不是必须的：用公网 IP 走 HTTP 也能跑，但要把 `MM_COOKIE_SECURE` 设成 `false`，**仅限临时演示**；正式使用请配 HTTPS（见 4.5）。

## 3. 环境变量

全部走环境变量，前缀 `MM_`（`config.py` 用 `env_prefix="MM_"`，字段 `llm_api_key` 对应 `MM_LLM_API_KEY`）。

### 3.1 必填

| 变量 | 说明 |
| --- | --- |
| `MM_DATABASE_URL` | `postgresql+psycopg://用户:密码@主机:5432/库名` |
| `MM_LLM_API_KEY` | 站点提供的大模型 Key（OpenAI 兼容） |

### 3.2 常用

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MM_LLM_BASE_URL` | 智谱 OpenAI 兼容端点 | 换供应商时改这里 |
| `MM_LLM_MODEL` / `MM_LLM_MODEL_FALLBACKS` | `glm-4-flash-250414` / 两个备用 | 主模型过载时自动降级 |
| `MM_ALLOW_REGISTRATION` | `true` | **正式环境建议设 `false`**，账号由管理员创建 |
| `MM_COOKIE_SECURE` | `auto` | `auto` 按 `X-Forwarded-Proto` 判断；纯 HTTP 演示设 `false` |
| `MM_SESSION_TTL_DAYS` | `30` | 会话有效期 |
| `MM_RAG_MODE` | `keyword` | 未装 fastembed 时保持 `keyword` |
| `MM_AUTO_MIGRATE` | `1` | 启动时自动迁移 |
| `MM_EXPOSE_LOGS` | `false` | **共享主机上必须保持 `false`**，不要把服务端日志推给客户端 |
| `MM_DATA_DIR` | `~/MindMeter` | 日志等临时文件目录，需可写 |

### 3.3 限流

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MM_LOGIN_MAX_ATTEMPTS` / `MM_LOGIN_WINDOW_S` | 10 / 300 | 登录失败限制 |
| `MM_REGISTER_MAX_ATTEMPTS` / `MM_REGISTER_WINDOW_S` | 50 / 3600 | 注册限制（NAT 后多人共用一个 IP，所以放宽） |

## 4. 部署（Docker，推荐）

Docker 路线和 Railway 用的是同一个 `Dockerfile`，行为一致。

### 4.1 准备目录

```bash
mkdir -p /opt/mindmeter && cd /opt/mindmeter
git clone https://github.com/waibibabo666/MindMeter.git src
cd src && git checkout develop
```

### 4.2 数据库（同机容器）

```bash
docker network create mindnet

docker run -d --name mindmeter-db --network mindnet \
  -e POSTGRES_USER=mm_app -e POSTGRES_PASSWORD='<强密码>' -e POSTGRES_DB=mindmeter \
  -v /opt/mindmeter/pgdata:/var/lib/postgresql/data \
  --restart unless-stopped postgres:16

# pgvector（RAG 需要；不装也能跑，降级为 keyword）
docker exec -it mindmeter-db psql -U mm_app -d mindmeter -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 4.3 应用容器

```bash
cd /opt/mindmeter/src
docker build -t mindmeter:latest .

docker run -d --name mindmeter-app --network mindnet \
  -p 127.0.0.1:8000:8000 \
  -e PORT=8000 \
  -e MM_DATABASE_URL='postgresql+psycopg://mm_app:<强密码>@mindmeter-db:5432/mindmeter' \
  -e MM_LLM_API_KEY='<key>' \
  -e MM_COOKIE_SECURE=true \
  -e MM_ALLOW_REGISTRATION=false \
  -e MM_EXPOSE_LOGS=false \
  --restart unless-stopped mindmeter:latest
```

首次启动会自动执行 `alembic upgrade head`（`MM_AUTO_MIGRATE=1`），日志里能看到迁移版本。

### 4.4 反向代理

```nginx
server {
    listen 80;
    server_name mind.example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # cookie_secure=auto 靠它
    }
}
```

`X-Forwarded-Proto` 不能省：缺了它后端会认为请求是 HTTP，`cookie_secure=auto` 不会给 cookie 加 Secure，登录状态在 HTTPS 下可能异常。

### 4.5 HTTPS

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d mind.example.com
```

证书就绪后把 `MM_COOKIE_SECURE` 保持 `true`（或 `auto`）。

### 4.6 防火墙

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

## 5. 部署（裸机，不用 Docker）

适合已经装了系统 PostgreSQL、不想引入容器的场景。

```bash
cd /opt/mindmeter/src
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 迁移（也可以交给 MM_AUTO_MIGRATE=1）
export MM_DATABASE_URL='postgresql+psycopg://mm_app:<密码>@127.0.0.1:5432/mindmeter'
.venv/bin/python -m alembic -c code/backend/alembic.ini upgrade head
```

systemd 单元：

```ini
[Unit]
Description=MindMeter
After=network.target postgresql.service

[Service]
User=mindmeter
WorkingDirectory=/opt/mindmeter/src/code/backend
EnvironmentFile=/etc/mindmeter/mindmeter.env
ExecStart=/opt/mindmeter/src/.venv/bin/uvicorn app.main:app \
  --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`--proxy-headers` 是必需的：没有它，后端看到的协议是 HTTP、客户端 IP 是 nginx 的地址，`cookie_secure=auto` 与限流都会失效。

## 6. 上线验证清单

- [ ] 健康检查返回 ok：`curl -s https://mind.example.com/api/v1/health`
- [ ] 首页可打开，控制台无 4xx/5xx
- [ ] 注册一个账号（或由管理员创建），能登录
- [ ] 刷新页面后仍处于登录态（cookie 生效；掉登录态多半是 `X-Forwarded-Proto` 缺失）
- [ ] 完成一次测评，报告页有分数
- [ ] 用第二个账号登录，**看不到第一个账号的数据**（数据隔离）
- [ ] 退出登录后访问需要登录的接口返回 401
- [ ] HTTPS 下响应头有 `Set-Cookie: mm_session=...; Secure; SameSite=Lax`
- [ ] 服务器重启后服务自动拉起（`reboot` 后复查）

## 7. 备份与升级

```bash
# 备份
docker exec mindmeter-db pg_dump -U mm_app -d mindmeter -Fc > /var/backups/mindmeter-$(date +%F).dump

# 升级
cd /opt/mindmeter/src
git pull && docker build -t mindmeter:latest .
docker rm -f mindmeter-app
# 用 4.3 的命令重新起（镜像名不变，数据在容器外）
```

迁移在应用启动时自动执行（`MM_AUTO_MIGRATE=1`）。跨大版本升级前先做一次备份。

回滚：把 `git checkout` 到上一个 tag 重新 build 起容器；数据库回退需谨慎，优先「代码回滚 + 保留数据库」。

## 8. 安全清单

- [ ] `MM_ALLOW_REGISTRATION=false`（正式环境）
- [ ] `MM_EXPOSE_LOGS=false`（共享主机）
- [ ] `MM_COOKIE_SECURE=true`（HTTPS 下）
- [ ] 数据库不暴露到公网，只允许应用所在网络访问
- [ ] 大模型 Key 只放环境变量，不进仓库、不进日志
- [ ] 反向代理透传 `Host` 与 `X-Forwarded-*`，且不改写 `Origin`
- [ ] 限流参数按实际调整（校园/企业 NAT 会共用一个出口 IP）
- [ ] 定期轮换 `MM_LLM_API_KEY`

## 9. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 登录后刷新又变未登录 | 缺 `X-Forwarded-Proto`，cookie 没带 Secure 或被丢弃 | nginx 加 `proxy_set_header X-Forwarded-Proto $scheme` |
| 所有接口 403 | 反向代理改写了 `Origin`，触发同源校验 | 让 `Origin` 原样透传 |
| 启动即退出，日志有 `relation ... does not exist` | 没跑迁移 | 设 `MM_AUTO_MIGRATE=1` 或手工 `alembic upgrade head` |
| 注册接口 429 | 同 IP 注册过于频繁 | 调 `MM_REGISTER_MAX_ATTEMPTS` / `MM_REGISTER_WINDOW_S` |
| 页面能开但接口 500 | `MM_DATABASE_URL` 不可达 | 在容器内 `psql` 验证连通性 |
| 回答总是「模板解读」 | `MM_LLM_API_KEY` 未配或失效 | 检查 Key 与 `MM_LLM_BASE_URL` |
| 容器内 8080 起不来 | 平台用 `$PORT`，自建需显式传 `PORT` | `-e PORT=8000` |

## 10. 与 Railway 的取舍

| 项 | Railway | 自建 |
| --- | --- | --- |
| 数据库 | 平台提供（pgvector 模板） | 自己装，pgvector 需手动建扩展 |
| TLS | 自动 | certbot 或云厂商证书 |
| 迁移 | `MM_AUTO_MIGRATE` 或 pre-deploy | 同 |
| 备份 | 平台快照 + 自行导出 | 自己写 cron |
| 国内访问 | 需绕 | 直连，快 |
| 成本 | 免费额度有限 | 机器包月 |

两条路的环境变量完全相同，切换时只需改 `MM_DATABASE_URL` 与是否配 TLS。
