# MindMeter 部署指南（自建服务器：Ubuntu + Nginx + PostgreSQL）

本文档说明如何把 MindMeter（FastAPI 后端 + 原生 JS 单页前端 + PostgreSQL + pgvector）部署到**自有 Linux 服务器**（云主机 ECS、实验室机器或校园网服务器均可），并提供上线前、中、后的检查单。

> 课程要求：**不使用托管平台（PaaS）**，因此本文以「自己装环境、自己起服务」为主线；文末附录说明为什么不用 Railway 这类托管方案。
>
> 本系统是**认知自我观察工具**，不是医疗器械，不提供诊断、治疗或危机干预。演示数据、示例账号只用于课程演示；接入真实用户前，必须替换默认配置、考虑关闭自助注册，并完成机构自身的隐私与安全评审。

相关文档：[本地开发与测试](local-development.md) · [架构说明](architecture.md) · [知识库说明](knowledge-base.md)

---

## 一、部署架构

```
用户浏览器 ──HTTPS(443)──> Nginx
                              ├── /            → 127.0.0.1:8000（uvicorn，FastAPI 同时托管前端静态文件）
                              └── /api/v1/*    → 同上，带 X-Forwarded-* 头
                                       │
                     ┌─────────────────┴──────────────────┐
                     │                                    │
          PostgreSQL 16 + pgvector               外部 LLM（OpenAI 兼容）
          业务库 / 知识库向量 / 审计日志           如智谱 open.bigmodel.cn
```

要点：

| 项 | 说明 |
| --- | --- |
| 前后端 | **没有前端构建步骤**，`code/frontend` 是静态文件，由 FastAPI 直接托管；同源部署，不需要 CORS，Cookie 保持 first-party |
| 端口 | uvicorn 只监听 `127.0.0.1:8000`，不直接对公网暴露；对外只有 Nginx 的 80/443 |
| 数据库 | PostgreSQL 16 + **pgvector 扩展**（迁移里执行 `CREATE EXTENSION vector`，**不装会迁移失败**） |
| 迁移 | 应用启动时自动 `alembic upgrade head`（`MM_AUTO_MIGRATE=1` 默认开）；也可手动执行作为发布门禁 |
| 健康检查 | `/api/v1/health/live`（不查库）与 `/api/v1/health`（查库、迁移版本、知识库块数） |
| 密钥 | `MM_LLM_API_KEY` 只放服务器环境变量文件，权限 640；不进仓库、不进前端、不进日志 |

---

## 二、服务器规格与容量

| 场景 | CPU | 内存 | 磁盘 | 说明 |
| --- | --- | --- | --- | --- |
| 课程演示 | 2 核 | 4 GB | 40 GB SSD | 应用 + 数据库同机足够 |
| 小规模试用（几十人） | 4 核 | 8 GB | 80 GB SSD | 建议数据库独立或加备份 |
| 正式使用 | 按并发实测 | 按并发实测 | 按日志留存估算 | 需重新评估隐私与等保要求 |

容量参考：

- 一次标准测评约 8 个任务，单账号数据以 KB 计；
- 知识库固定 30 块，`kb_chunks` 含向量列，约 1–2 MB；
- 主要外部依赖是模型调用（默认超时 45 秒），主要写放大来自对话与审计表；
- 应用空闲内存约 200–300 MB（无本地嵌入模型，RAG 走关键词）。

> 若服务器内存 ≤ 2 GB，务必配 2 GB swap，否则 `pip install` 或迁移阶段可能被 OOM Killer 打断。

---

## 三、服务器环境准备

以 **Ubuntu 22.04 / 24.04** 为例（Debian 12 同理；CentOS/RHEL 把 `apt` 换成 `dnf`，包名改为 `postgresql16-server`、`pgvector_16`）。

```bash
# 1. 基础软件
sudo apt update
sudo apt install -y git nginx python3 python3-venv python3-pip \
    postgresql postgresql-contrib postgresql-16-pgvector \
    curl ufw logrotate

# 2. 版本确认（需要 Python 3.12+）
python3 --version
psql --version

# 3. 专用运行用户与目录
sudo useradd -r -m -s /usr/sbin/nologin mindmeter
sudo mkdir -p /opt/mindmeter /var/backups/mindmeter /etc/mindmeter
sudo chown mindmeter:mindmeter /opt/mindmeter /var/backups/mindmeter
```

> 如果 `postgresql-16-pgvector` 装不上（发行版没有该包），先加 PostgreSQL 官方源，或直接从源码 `apt install postgresql-server-dev-16 && make && make install` 编译 pgvector。**这一步不能跳过**——缺扩展会导致首次迁移失败、表建不出来。

### 数据库初始化（专用角色，不用超级用户）

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE mindmeter_app LOGIN PASSWORD '<强密码>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE mindmeter OWNER mindmeter_app ENCODING 'UTF8' TEMPLATE template0;
\c mindmeter
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL ON SCHEMA public TO mindmeter_app;
SQL
```

说明：

- 扩展由超级用户装一次即可；应用角色不需要超级权限；
- 编码必须是 UTF8，否则中文会乱码；
- 迁移脚本里有一段 `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mm_app')` 的授权语句，角色不存在时自动跳过，**不需要**为了它去建 `mm_app` 账号。

---

## 四、部署步骤

### 1. 获取代码

```bash
sudo -u mindmeter -H bash
cd /opt/mindmeter
git clone <your-repo-url> src && cd src
git checkout <release-tag>        # 用明确的 tag，不要直接跑 develop
git rev-parse HEAD                # 记录 Commit SHA
```

### 2. 装依赖

```bash
cd /opt/mindmeter/src
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python -c "import fastapi, sqlalchemy, langgraph; print('deps ok')"
```

> 依赖版本已在 `requirements.txt` 锁定（`fastapi==0.162.7`、`sqlalchemy==2.1.8`、`psycopg[binary]==3.3.9` 等），不要用 `pip install -U` 覆盖。

### 3. 配置环境变量

```bash
sudo install -m 640 -o root -g mindmeter /dev/null /etc/mindmeter/mindmeter.env
sudo tee /etc/mindmeter/mindmeter.env >/dev/null <<'EOF'
# ---- 数据库（必填）----
MM_DATABASE_URL=postgresql+psycopg://mindmeter_app:<强密码>@127.0.0.1:5432/mindmeter

# ---- 模型（可选；不填则解读自动回退模板）----
MM_LLM_API_KEY=<你的 key>
MM_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
MM_LLM_MODEL=glm-4-flash-250414
MM_LLM_MODEL_FALLBACKS=glm-4-air-250414,glm-4.5-flash

# ---- 账号与安全 ----
MM_ALLOW_REGISTRATION=true
MM_SESSION_TTL_DAYS=30
MM_COOKIE_SECURE=auto
MM_LOGIN_MAX_ATTEMPTS=10

# ---- 其他 ----
MM_RAG_MODE=keyword
MM_AUTO_MIGRATE=1
MM_DATA_DIR=/opt/mindmeter/data
MM_EXPOSE_LOGS=false
EOF
sudo mkdir -p /opt/mindmeter/data && sudo chown mindmeter:mindmeter /opt/mindmeter/data
```

密钥文件不要进 Git；用 `sudo git grep -n "sk-"` 自查一遍仓库。

### 4. 初始化数据库（可手动执行）

```bash
cd /opt/mindmeter/src/code/backend
source /opt/mindmeter/src/.venv/bin/activate
export $(grep -v '^#' /etc/mindmeter/mindmeter.env | xargs)
alembic upgrade head
alembic current       # 应输出版本号
```

首次迁移会建表、建索引并 `CREATE EXTENSION vector`。失败时先看报错：多半是扩展没装、角色权限不够或编码不是 UTF8。

### 5. systemd 托管

```bash
sudo tee /etc/systemd/system/mindmeter.service >/dev/null <<'EOF'
[Unit]
Description=MindMeter web app
After=network.target postgresql.service

[Service]
Type=simple
User=mindmeter
Group=mindmeter
WorkingDirectory=/opt/mindmeter/src/code/backend
EnvironmentFile=/etc/mindmeter/mindmeter.env
ExecStart=/opt/mindmeter/src/.venv/bin/python -m uvicorn app.main:app \
    --host 127.0.0.1 --port 8000 \
    --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mindmeter
sudo systemctl status mindmeter --no-pager
curl -s http://127.0.0.1:8000/api/v1/health/live
```

> `--proxy-headers --forwarded-allow-ips 127.0.0.1` 必须保留：否则 `MM_COOKIE_SECURE=auto` 判断不出 https（登录会掉），限流也拿不到真实 IP。

### 6. Nginx 反向代理

```bash
sudo tee /etc/nginx/sites-available/mindmeter >/dev/null <<'EOF'
server {
    listen 80;
    server_name mindmeter.example.com;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;     # 模型最长 45s，留余量
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/mindmeter /etc/nginx/sites-enabled/mindmeter
sudo nginx -t && sudo systemctl reload nginx
```

### 7. HTTPS 与防火墙

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mindmeter.example.com      # 自动改 80→443 并续期
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

（无域名的纯 IP 演示：先跳过证书，用 `http://ip` 访问，但**不要**在纯 http 下把 `MM_COOKIE_SECURE` 设成 true。）

### 8. 上线冒烟

```bash
# 在开发机或服务器上
python scripts/smoke_web_deploy.py https://mindmeter.example.com
# 已关闭自助注册时
python scripts/smoke_web_deploy.py https://mindmeter.example.com --no-register
```

检查项：公开健康探针、Cookie 会话、账号间数据隔离、静态壳、**密钥不回显**。退出码 0 才算通过。

---

## 五、发布检查单

### A. 发布准备

- [ ] 目标 commit 已通过 CI（lint / 单测 / E2E / 密钥扫描）
- [ ] 记录 Commit SHA 与部署时间
- [ ] 涉及表结构变更时，先在一份数据库副本上跑 `alembic upgrade head`

### B. 配置检查

- [ ] `/etc/mindmeter/mindmeter.env` 权限 640、owner root:mindmeter
- [ ] `MM_DATABASE_URL` 指向本机库（不要用超级用户）
- [ ] `MM_LLM_API_KEY` 只存在于 env 文件（`git grep` 确认仓库里没有）
- [ ] `MM_ALLOW_REGISTRATION` 与本次用途一致
- [ ] `MM_COOKIE_SECURE=auto`（http 环境设 true 会登不上）

### C. 数据库检查

- [ ] `psql -c '\dx vector'` 能看到 vector 扩展
- [ ] `alembic current` 与代码版本一致
- [ ] `/api/v1/health` 里 `db.connected=true`、`rag.chunks ≥ 30`

### D. 基础设施检查

- [ ] uvicorn 只监听 127.0.0.1（`ss -lntp | grep 8000`）
- [ ] Nginx 配置 `nginx -t` 通过，443 生效
- [ ] 防火墙只开 22/80/443
- [ ] 磁盘余量 ≥ 20%

### E. 发布执行

- [ ] `systemctl restart mindmeter` 后 10 秒内 health 正常
- [ ] 失败时先看 `journalctl -u mindmeter -n 100` 再决定是否回滚

### F. 发布验证

- [ ] `smoke_web_deploy.py` 全绿
- [ ] 手动五步：注册 → 快测 → 报告 → 对话 → 趋势
- [ ] 模型不可用时回退模板（回答出现「模板」标记）
- [ ] 未登录访问 `/#/report` 跳登录，无半屏 401

### G. 发布完成

- [ ] 更新 README 的部署地址
- [ ] 通知使用方（演示账号、注意事项）
- [ ] 记录变更与已知问题

---

## 六、运维手册

### 健康检查与监控

```bash
# 存活（不查库）
curl -sf http://127.0.0.1:8000/api/v1/health/live
# 就绪（查库 + 迁移 + 知识库块数）
curl -s http://127.0.0.1:8000/api/v1/health | python3 -m json.tool
```

建议用 cron 每 5 分钟探测一次，连续 3 次失败再告警：

```bash
*/5 * * * * curl -sf http://127.0.0.1:8000/api/v1/health >/dev/null || logger -t mindmeter "health check failed"
```

### 日志

```bash
journalctl -u mindmeter -f            # 应用日志（stdout）
sudo tail -f /var/log/nginx/access.log
```

日志轮转交给系统默认的 logrotate；`MM_EXPOSE_LOGS=false` 确保不对客户端开放服务端日志。

### 备份与恢复

```bash
# 每日 3 点备份（保留 14 天）
sudo tee /etc/cron.d/mindmeter-backup >/dev/null <<'EOF'
0 3 * * * mindmeter PGPASSWORD=<密码> pg_dump -Fc -h 127.0.0.1 -U mindmeter_app -d mindmeter \
  -f /var/backups/mindmeter/mindmeter-$(date +\%Y\%m\%d).dump
EOF

# 恢复演练（务必做过一次）
pg_restore -h 127.0.0.1 -U mindmeter_app -d mindmeter_test --clean --if-exists backup.dump
```

用户侧也有「导出数据」：本账号 JSON（含测评、记忆、对话），不含任何密钥。

### 更新

```bash
cd /opt/mindmeter/src
git fetch --tags && git checkout <new-tag>
source .venv/bin/activate && pip install -r requirements.txt
sudo systemctl restart mindmeter
curl -s http://127.0.0.1:8000/api/v1/health | python3 -m json.tool
```

**先备份再更新**；迁移只前进不回退。

### 停止 / 卸载

```bash
sudo systemctl stop mindmeter      # 停应用（数据库仍在）
sudo systemctl disable mindmeter
# 彻底卸载：先导出数据，再删服务、库与目录
```

---

## 七、账号与数据处理

- 第一个注册的账号即演示账号；注册后立刻改密码；
- 对外发布建议 `MM_ALLOW_REGISTRATION=false`，改用受邀创建；
- 用户可自助：改密码、退出所有设备、导出数据、注销账号（注销即删除该账号全部数据）；
- 演示不要用真实个人信息；手机号/身份证会被脱敏，但没必要冒险。

---

## 八、校园网与等保三级

如果服务器接入**校园网**，按要求必须通过等级保护三级测评。按 [等保三级软件设计开发部署要求](https://github.com/bettermorn/IntelligentSWEPractice/blob/main/docs/%E7%AD%89%E4%BF%9D%E4%B8%89%E7%BA%A7_%E8%BD%AF%E4%BB%B6%E8%AE%BE%E8%AE%A1%E5%BC%80%E5%8F%91%E9%83%A8%E7%BD%B2%E8%A6%81%E6%B1%82.md)，本项目当前**不满足**：

| 要求 | 现状 | 差距 |
| --- | --- | --- |
| 双因素认证（一种为密码技术） | 仅口令 | ❌ |
| 三权分立（系统/安全/审计管理员） | 仅普通用户 | ❌ |
| 安全标记（数据密级） | 无 | ❌ |
| 集中审计、日志外送、防篡改 | 库内审计表 | ⚠️ 部分 |
| 重要数据字段级加密与密钥管理 | 仅口令 PBKDF2 | ❌ |
| 制品签名、SAST/SCA 门禁 | 密钥扫描 + 测试 | ⚠️ 部分 |
| 定级备案、测评 | 无 | ❌ 组织流程 |

**结论**：课程演示可部署在**公网云主机（ECS）**上，不接入校园网；若要进校园网，需先补齐上表能力并完成定级备案与测评，不属于课程周期内可完成的范围。答辩时如实说明即可。

---

## 九、回滚方案

1. **代码回滚**：`git checkout <上一个 tag>` → `pip install -r requirements.txt` → `systemctl restart mindmeter`；
2. **数据库**：迁移只前进。若新版本改了表结构，回滚代码前先确认旧代码能读新表；不能则用备份恢复到新库并切换 `MM_DATABASE_URL`；
3. **配置**：环境变量改错时优先改回变量值，不必回滚代码；
4. 回滚后**必须重跑** `smoke_web_deploy.py`。

---

## 十、常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 迁移报 `type "vector" does not exist` | 未安装 pgvector | `apt install postgresql-16-pgvector` 后重跑 |
| 迁移报权限不足 | 应用角色不是库 owner | 用超级用户执行 `CREATE EXTENSION`，或把库 owner 设为应用角色 |
| 启动后 500，`/health/live` 却 200 | `MM_DATABASE_URL` 没配或写错 | 检查 env 文件与 `systemctl show mindmeter -p Environment` |
| 登录后立刻掉线 | 反代没传 `X-Forwarded-Proto`，或 uvicorn 没开 `--proxy-headers` | 两者都补上 |
| 页面 404 | `MM_FRONTEND_DIR` 指向错误 | 默认取 `code/frontend`，确认代码目录完整 |
| 回答慢/报 429 | 模型免费池过载 | 已配 `MM_LLM_MODEL_FALLBACKS` 自动切换；仍失败回退模板 |
| 中文乱码 | 库编码非 UTF8 | 重建库 `ENCODING 'UTF8' TEMPLATE template0` |
| `pip install` 被杀 | 内存不足 | 加 2 GB swap |
| 时间不对 | 服务器时区 | `timedatectl set-timezone Asia/Shanghai` |

---

## 十一、最终检查卡

```
[ ] pgvector 扩展已安装（\dx vector 可见）
[ ] /etc/mindmeter/mindmeter.env 权限 640，密钥未进仓库
[ ] alembic current 与代码版本一致
[ ] uvicorn 只监听 127.0.0.1:8000
[ ] Nginx 443 生效，HTTP 跳转 HTTPS
[ ] /api/v1/health 返回 db.connected=true、rag.chunks ≥ 30
[ ] smoke_web_deploy.py 全绿
[ ] 手动五步：注册 → 快测 → 报告 → 对话 → 趋势
[ ] 模型不可用时回退模板（页面不空白）
[ ] 备份任务已配置并做过一次恢复演练
```

---

## 附录：为什么不用托管平台（PaaS）

课程要求明确「不要托管部署」，因此 Railway / Render / Vercel 这类方案**不作为交付路径**。保留 `Dockerfile` 与 `railway.json` 只是历史产物，方便在任意 Linux 主机上用 Docker 跑：

```bash
# 自建服务器上仍可用 Docker（属于自建部署，不是托管）
docker build -t mindmeter .
docker run -d --name mindmeter --restart=unless-stopped \
  --env-file /etc/mindmeter/mindmeter.env \
  -p 127.0.0.1:8000:8000 mindmeter
```

两者的差异：托管平台帮你管 TLS、进程与数据库，但不满足「自己部署到自己服务器」的要求；自建方案需要自己承担 Nginx、systemd、备份与升级——本文档已经把这几件事写全。
