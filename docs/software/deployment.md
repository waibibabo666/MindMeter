# 部署指南

> 本文档说明如何把本项目（FastAPI 后端 + 原生 JS 单页前端 + PostgreSQL）部署到 **Linux 云服务器**，并给出上线前、中、后的检查单。
>
> 文中命令与数值均为 **2026-11 在阿里云 ECS（2 核 / 1.6 GB）上实际执行**的结果，未验证的部分会明确标注。

## 一、部署形态与可行性

### 1.1 三种形态

| 形态 | 状态 | 说明 |
| --- | --- | --- |
| Windows 桌面版 | ✅ 受支持 | 双击 `MindMeter.cmd`，launcher 管理 PostgreSQL 与窗口，见[本地运行时](local-runtime.md) |
| **Linux 单机（本文）** | ✅ 已实测 | nginx + uvicorn + 系统 PostgreSQL，同机部署 |
| 公网多用户 | ❌ 不适用 | 无账号体系、无 JWT，只有单 token（见 [ADR-0001](../adr/0001-local-desktop-runtime.md)） |

### 1.2 三处代码限制（部署前必须绕过）

后端按「只服务本机」设计，`code/backend/app/security.py` 里有三道校验：

| 校验 | 代码 | 现象 | 本文的绕过方式 |
| --- | --- | --- | --- |
| 仅接受 loopback 客户端 | `request.client.host not in {"127.0.0.1","::1"}` | 跨机反代一律 403 `loopback_only` | nginx 与后端**同机** |
| Host 必须是 localhost | `_host_ok()` | 用域名访问 **400 `invalid_host`** | nginx `proxy_set_header Host 127.0.0.1:8000` |
| Origin 必须是本地 | `_origin_ok()` | 浏览器请求 **403 `invalid_origin`** | nginx `proxy_set_header Origin ""` |

另外两点差异：

- **没有 `/ready`**：只有 `GET /api/v1/health`，库不可用时返回 **503** 且 `status: degraded`。
- **前端需要 token**：页面从 `window.__MM_BOOT__` 读 token，桌面版由 pywebview 注入，服务器上要自己注入（见 3.6）。

### 1.3 实测环境

| 项 | 实测值 |
| --- | --- |
| 云厂商 / 地域 | 阿里云 ECS，华北（北京） |
| 系统 | Ubuntu 22.04.5 LTS（内核 5.15.0-142） |
| CPU / 内存 | 2 核 / **1608 MB**（另加 2 GB swap） |
| 磁盘 | 40 GB（部署后剩 31 GB） |
| Python | 3.12.16（venv） |
| PostgreSQL | 14.24 |
| pgvector | 0.8.0（源码编译） |
| nginx | 1.18.0 |
| 部署提交 | `feat/assessment-tiers@9ccb108` |
| 数据表 | 13 张 |
| 应用内存占用 | 空闲约 200 MB |

> **1.6 GB 内存偏紧**，必须加 swap，否则 `pip install` 会 OOM。推荐 4 GB 起。

## 二、服务器准备

### 2.1 规格建议

| 场景 | CPU | 内存 | 磁盘 | 说明 |
| --- | --- | --- | --- | --- |
| 演示 / 答辩 | 2 核 | 4 GB | 40 GB | 本文实测为 2 GB，可用但需 swap |
| 小规模使用 | 4 核 | 8 GB | 100 GB | 建议 PostgreSQL 同机 |
| 正式使用 | 按实际 | 按实际 | 按实际 | 见 1.1，当前不支持多用户 |

### 2.2 安全组

只开放三个端口，**不要开 8000 和 5432**：

```text
22/tcp    你的出口 IP/32
80/tcp    0.0.0.0/0
443/tcp   0.0.0.0/0
```

### 2.3 基础软件

```bash
apt update && apt upgrade -y

apt install -y git nginx postgresql postgresql-client curl unzip ufw \
    software-properties-common apache2-utils

# 实测：nginx 1.18.0 / PostgreSQL 14.24 / git 2.34.1
```

### 2.4 swap（1.6 GB 机器必做）

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h    # 期望 Swap: 2.0Gi
```

### 2.5 Python 3.12

Ubuntu 22.04 自带 3.10，装不上 `fastapi==0.162.7`：

```bash
add-apt-repository -y ppa:deadsnakes/ppa
apt update
apt install -y python3.12 python3.12-venv python3.12-dev
python3.12 --version    # Python 3.12.16
```

### 2.6 PostgreSQL 与角色

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE mm_app  LOGIN PASSWORD '<应用强密码>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE mm_admin LOGIN SUPERUSER PASSWORD '<迁移强密码>';
CREATE DATABASE mindmeter OWNER mm_app ENCODING 'UTF8';
SQL
```

| 角色 | 用途 | 权限 |
| --- | --- | --- |
| `mm_admin` | **只用于迁移** | SUPERUSER（`CREATE EXTENSION` 需要） |
| `mm_app` | 运行期连接 | 普通角色，仅本库读写 |

### 2.7 pgvector（apt 里没有，需编译）

实测 `apt install postgresql-14-pgvector` 报 `Unable to locate package`，改为源码编译：

```bash
apt install -y build-essential postgresql-server-dev-14
cd /tmp && git clone --branch v0.8.0 --depth 1 https://github.com/pgvector/pgvector.git
cd pgvector && make -j2 && make install
ls /usr/share/postgresql/14/extension/vector.control    # 存在即成功
```

然后在库里创建扩展（必须用超级用户）：

```bash
sudo -u postgres psql -d mindmeter -c "CREATE EXTENSION IF NOT EXISTS vector"
sudo -u postgres psql -d mindmeter -c "GRANT USAGE ON TYPE vector TO mm_app"
```

> 不装 pgvector 也能跑（RAG 降级为 `keyword`），但 **`0001_initial` 迁移里硬编码了 `CREATE EXTENSION`**，不装会导致迁移失败。

## 三、部署步骤

### 3.1 目录与代码

```bash
useradd -r -m -s /usr/sbin/nologin mindmeter
mkdir -p /opt/mindmeter /var/backups/mindmeter /var/lib/mindmeter /etc/mindmeter
chown mindmeter:mindmeter /var/lib/mindmeter /var/backups/mindmeter
chown root:mindmeter /etc/mindmeter && chmod 750 /etc/mindmeter

cd /opt/mindmeter
git clone https://github.com/waibibabo666/MindMeter.git src
cd src && git checkout feat/assessment-tiers
git rev-parse --short HEAD    # 实测 9ccb108
```

> **阿里云拉 GitHub 不稳定**（实测反复出现 `GnuTLS recv error` / `HTTP2 framing error`）。
> 后续更新建议用本地一键脚本推送（见 5.3），服务器上只在首次 clone 时访问 GitHub。

### 3.2 Python 依赖

```bash
cd /opt/mindmeter/src
python3.12 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q \
  fastapi==0.162.7 uvicorn==0.54.0 sqlalchemy==2.1.8 alembic==1.20.1 \
  "psycopg[binary]==3.3.9" pgvector==0.5.1 pydantic-settings==2.16.3 \
  keyring==25.7.0 httpx==0.28.1 langgraph==1.2.21 langchain-core==1.8.0 \
  python-multipart==0.0.33 vosk==0.3.45
```

**跳过两个依赖**（服务器不需要）：

| 依赖 | 为什么跳过 |
| --- | --- |
| `pywebview` | 只用于桌面窗口，服务器跑 uvicorn |
| `fastembed` | 向量模型，1.6 GB 内存吃不下；RAG 自动降级为 `keyword` |

依赖清单固化在 `/opt/mindmeter/requirements.server.txt`。

### 3.3 环境变量

```bash
cat > /etc/mindmeter/mindmeter.env <<EOF
MM_API_TOKEN=<openssl rand -hex 32>
MM_DATABASE_URL=postgresql+psycopg://mm_app:<应用密码>@127.0.0.1:5432/mindmeter
MM_DATA_DIR=/var/lib/mindmeter
MM_RAG_MODE=keyword
EOF
chmod 640 /etc/mindmeter/mindmeter.env && chown root:mindmeter /etc/mindmeter/mindmeter.env

# token 单独存一份，供前端注入与健康检查
echo "<同一个 token>" > /etc/mindmeter/api-token && chmod 600 /etc/mindmeter/api-token

# 迁移专用 DSN（含 mm_admin 密码）
echo 'MM_MIGRATION_DATABASE_URL=postgresql+psycopg://mm_admin:<迁移密码>@127.0.0.1:5432/mindmeter' \
  > /etc/mindmeter/migrate.env && chmod 600 /etc/mindmeter/migrate.env
```

变量命名规则：`app/config.py` 用 `env_prefix="MM_"`，字段 `api_token` 对应 `MM_API_TOKEN`。
**grep 源文件找不到 `MM_API_TOKEN` 是正常的**（字段名叫 `api_token`）。

### 3.4 迁移

```bash
cd /opt/mindmeter/src
set -a; . /etc/mindmeter/migrate.env; set +a
.venv/bin/python -m alembic -c code/backend/alembic.ini upgrade head
```

实测输出：`0001_initial` → `0002_seed_kb`，完成后 13 张表。

### 3.5 systemd

```ini
[Unit]
Description=MindMeter
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=mindmeter
Group=mindmeter
WorkingDirectory=/opt/mindmeter/src/code/backend
Environment="MM_API_TOKEN=<token>"
Environment="MM_DATABASE_URL=postgresql+psycopg://mm_app:<密码>@127.0.0.1:5432/mindmeter"
Environment="MM_DATA_DIR=/var/lib/mindmeter"
Environment="MM_RAG_MODE=keyword"
ExecStart=/opt/mindmeter/src/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/mindmeter

[Install]
WantedBy=multi-user.target
```

```bash
chmod 600 /etc/systemd/system/mindmeter.service   # 里面有密钥
systemctl daemon-reload && systemctl enable --now mindmeter
```

**为什么用 `Environment=` 而不是 `EnvironmentFile=`**：实测该机器上 `EnvironmentFile` 指向的文件没有被注入进程（`/proc/PID/environ` 里没有 `MM_API_TOKEN`，健康检查持续 401），改用内联 `Environment=` 后恢复正常。代价是密钥落在 unit 文件里，所以 `chmod 600`。

`--workers 1` 是当前唯一可靠取值：应用有进程内状态（会话、RAG 缓存、前端日志缓冲）。

### 3.6 前端部署与 token 注入

不要直接改仓库里的 `index.html`，复制到 `/opt/mindmeter/web` 再注入：

```bash
mkdir -p /opt/mindmeter/web
cp -a /opt/mindmeter/src/code/frontend/. /opt/mindmeter/web/

TOKEN=$(cat /etc/mindmeter/api-token)
printf 'window.__MM_BOOT__ = { apiBase: "/api/v1", token: "%s" };\n' "$TOKEN" \
  > /opt/mindmeter/web/boot.js

grep -q 'boot.js' /opt/mindmeter/web/index.html || \
  sed -i 's#</body>#  <script src="./boot.js"></script>\n</body>#' /opt/mindmeter/web/index.html

chown -R www-data:www-data /opt/mindmeter/web
```

这套步骤已脚本化为 `/opt/mindmeter/deploy-web.sh`，可重复执行（幂等）。

### 3.7 nginx

```nginx
server {
    listen 80 default_server;
    server_name _;
    root /opt/mindmeter/web;
    index index.html;
    client_max_body_size 20m;        # /api/v1/asr 上传整段 wav

    auth_basic "MindMeter";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_read_timeout 180s;

        # 绕过后端「仅本机」的三道校验，缺一不可
        proxy_set_header Host 127.0.0.1:8000;
        proxy_set_header Origin "";
        proxy_set_header X-Real-IP 127.0.0.1;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
htpasswd -bc /etc/nginx/.htpasswd admin '<访问密码>'
ln -sf /etc/nginx/sites-available/mindmeter /etc/nginx/sites-enabled/mindmeter
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

**`auth_basic` 是必需的**：`boot.js` 里 token 是明文，任何能访问页面的人都拿得到；没有 Basic Auth 等于无认证。

### 3.8 防火墙

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
```

## 四、发布检查单

### A. 发布准备

- [ ] 代码已评审（`develop` 受分支保护，需 1 个 approve）
- [ ] `npm run check` 通过（lint + format:check + 全部测试）
- [ ] `python -m pytest -q tests/backend -rs` 通过（需 `MM_TEST_DATABASE_URL`）
- [ ] 依赖已锁定（`requirements.server.txt`）
- [ ] 记录 Git Tag 与 `git rev-parse HEAD`
- [ ] 本次是否含 alembic 迁移已确认（看 `code/backend/alembic/versions/`）
- [ ] `python scripts/check_docs.py` 与 `python scripts/check_secrets.py` 通过

### B. 配置检查

- [ ] `/etc/mindmeter/mindmeter.env` 权限 640、属主 `root:mindmeter`
- [ ] `/etc/mindmeter/api-token` 与 unit 里的 `MM_API_TOKEN` **一致**（实测出现过不一致导致 401）
- [ ] `MM_DATABASE_URL` 使用 `mm_app`，不是 `mm_admin`
- [ ] `MM_RAG_MODE=keyword`（未装 fastembed 时不要设 `auto`）
- [ ] 服务以 `mindmeter` 用户运行，非 root
- [ ] worker 数固定 1
- [ ] 服务器时区已确认（应用存 ISO 时间，展示按浏览器时区）

### C. 数据库检查

- [ ] 已备份且**验证过可恢复**
- [ ] 至少每日逻辑备份、保留 14 天
- [ ] 磁盘使用率告警已配置
- [ ] 迁移在测试库演练过
- [ ] 切勿对生产库调用 `DELETE /api/v1/data`（会清空全部数据）

```bash
# 备份
sudo -u mindmeter bash -c 'set -a; . /etc/mindmeter/mindmeter.env; set +a;
  pg_dump -h 127.0.0.1 -U mm_app -d mindmeter -Fc -f /var/backups/mindmeter/$(date +%F).dump'

# 恢复演练
sudo -u postgres psql -c "CREATE DATABASE mindmeter_restore OWNER mm_app"
pg_restore -h 127.0.0.1 -U mm_app -d mindmeter_restore --no-owner /var/backups/mindmeter/2026-11-21.dump
```

定时任务 `/etc/cron.d/mindmeter-backup`：

```cron
30 2 * * * root set -a; . /etc/mindmeter/mindmeter.env; set +a; pg_dump -h 127.0.0.1 -U mm_app -d mindmeter -Fc -f /var/backups/mindmeter/$(date +\%F).dump && find /var/backups/mindmeter -name '*.dump' -mtime +14 -delete
```

### D. 基础设施检查

- [ ] 规格满足（本文实测 2 核 1.6 GB 可跑，但需 swap）
- [ ] 安全组只开 22 / 80 / 443
- [ ] `nginx -t` 通过
- [ ] systemd 已 enable（开机自启）
- [ ] 日志可读：`journalctl -u mindmeter`
- [ ] 监控：`GET /api/v1/health` 每分钟探测，非 200 告警
- [ ] 时间同步（`timedatectl`）

### E. 发布执行

```bash
cd /opt/mindmeter/src && git checkout <tag>     # 或用 5.3 的推送式部署
systemctl restart mindmeter
```

- [ ] 发布记录已开启
- [ ] 已备份数据库
- [ ] 迁移已完成（有变更时）
- [ ] 服务重启后 `/health` 返回 200（含 `db.connected: true`）
- [ ] `journalctl -u mindmeter -n 100` 无异常

### F. 发布验证

- [ ] 首页可打开（Basic Auth 通过，无证书错误）
- [ ] 控制台无严重错误
- [ ] 走完一次测评，报告 **8 个维度都有「分数 ±区间」**，不是全「未测」
- [ ] 游戏中心 24 张卡片
- [ ] 趋势页、记忆页正常
- [ ] 对话页显示「模板」解读（未配 LLM Key 时的预期行为）
- [ ] 导出 JSON 成功且不含 Key
- [ ] 语音识别：无麦克风/模型时显示「未测」，不是 0 分

### G. 发布完成

- [ ] 记录最终版本与 Commit SHA
- [ ] 更新 `CHANGELOG.md`
- [ ] 通知相关人，关闭发布窗口
- [ ] 保留上一版本与发布前备份

## 五、运维

### 5.1 常用命令

```bash
systemctl status mindmeter          # 状态
journalctl -u mindmeter -n 100      # 应用日志
systemctl restart mindmeter         # 重启
tail -f /var/log/nginx/error.log    # nginx 错误

# 健康检查（服务器本机）
curl -s -H "X-MM-Token: $(cat /etc/mindmeter/api-token)" http://127.0.0.1:8000/api/v1/health
```

### 5.2 接口

| 接口 | 用途 | 说明 |
| --- | --- | --- |
| `GET /api/v1/health` | 存活 + 数据库连通 | 库不可用返回 **503 `degraded`** |
| `GET /api/v1/export` | 导出全部数据 | 不含 Key |
| `DELETE /api/v1/data` | 清空数据 | **危险**，无二次确认 |

### 5.3 更新（推荐：本地推送）

服务器拉 GitHub 不稳定，改为**本地打包推送**（实测 7 秒完成）：

```powershell
# 在本地仓库根目录
powershell -ExecutionPolicy Bypass -File scripts\deploy-remote.ps1
```

脚本做的事：`git archive` 当前提交 → `scp` 上传 → 解包 → `alembic upgrade` → 硬重启（停服、等端口释放、起服）→ 部署前端 → 健康检查轮询。

服务器上也留了一个 `/opt/mindmeter/update.sh`，但它第一步是 `git pull`，**网络不稳时不建议用**。

### 5.4 回滚

```bash
# 代码回滚：先用本地脚本把旧提交推上去
powershell -ExecutionPolicy Bypass -File scripts\deploy-remote.ps1 -Ref <旧提交>

# 或服务器上
cd /opt/mindmeter/src && git checkout <previous-tag>
systemctl restart mindmeter
```

- 无迁移变更：只回滚代码；
- 有迁移变更：优先「代码回滚 + 保留数据库」；
- 必须回退数据：恢复到新库验证后再切 `MM_DATABASE_URL`，**不要覆盖生产库**。

## 六、安全边界（重要）

| 项 | 现状 | 风险 |
| --- | --- | --- |
| 认证 | 单 token + nginx Basic Auth | token 明文在 `/boot.js`，拿到页面即可读 |
| 用户体系 | **无** | 所有访问者共享同一份数据，可互相覆盖 |
| 危险接口 | `DELETE /api/v1/data` 无二次确认 | 拿到 token 即可清库 |
| LLM Key | 只存 keyring | 服务器无桌面环境 → `/api/v1/settings/ai` 返回 503，AI 解读降级为模板 |
| 数据出网 | 仅 LLM 调用（未配置则不出网） | 音频、测评数据全部留在本机 |

**结论：只适合自己使用或答辩演示。** 要多人长期使用，需要先做账号体系与权限模型。

## 七、常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 域名访问 **400 `invalid_host`** | Host 校验 | nginx 加 `proxy_set_header Host 127.0.0.1:8000` |
| **403 `invalid_origin`** | Origin 校验 | nginx 加 `proxy_set_header Origin ""` |
| **403 `loopback_only`** | 反代与后端不同机 | 必须同机部署 |
| **401 `unauthorized`** | token 不一致或为空 | 比对 `api-token` 与 unit 内 `MM_API_TOKEN` |
| 页面空白、侧栏在 | 前端模块 404（import 路径错） | F12 → Network 看 4xx |
| 显示「本地服务没有启动」 | `boot.js` 缺失或语法错（token 被截断） | `cat /opt/mindmeter/web/boot.js` 检查 |
| `pip install` 找不到 `fastapi==0.162.7` | Python < 3.12 | 装 3.12 并用绝对路径 |
| 迁移报 `extension "vector" is not available` | 未装 pgvector | 按 2.7 源码编译 |
| 迁移报 `permission denied to create extension` | 用的是 `mm_app` | 迁移改用 `mm_admin` |
| nginx **500** 且日志有 `rewrite or internal redirection cycle` | `try_files` 写成了 `\$uri` | 去掉反斜杠 |
| 重启后 60 秒内 401 | 旧进程未退出、新进程未接管 | 停服后等端口释放再起（`deploy-remote.ps1` 已处理） |
| 上传音频 **413** | `client_max_body_size` 太小 | 调到 20m |
| 页面加载但接口 503（`/settings/ai`） | 服务器无 keyring，读不到 Key | 预期行为，AI 解读用模板 |

## 八、相关文档

- [本地运行时](local-runtime.md)：Windows 桌面版的安装、目录、日志、排障
- [ADR-0001 本地桌面运行时](../adr/0001-local-desktop-runtime.md)：为什么不做服务端、为什么无账号体系
- [技术方案](architecture.md)：历史 L2 设计（已被 ADR 取代）
- [测试与评测计划](test-plan.md)：部署后如何验收
