# 本地桌面运行时

## 一次安装（Windows x64）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
```

等价于：安装 `requirements-dev.txt`、`npm ci`、下载/解压便携 PostgreSQL + pgvector。
需要 Node 24+、Python 3.12+、Windows 10/11 x64、WebView2 Runtime（Win11 自带）。

## 双击入口

| 文件 | 用途 |
| --- | --- |
| [`MindMeter.cmd`](../../MindMeter.cmd) | 双击启动；保留控制台，启动失败时能看到原因 |
| [`MindMeter.vbs`](../../MindMeter.vbs) | 双击启动；不显示控制台窗口 |
| [`code/desktop/launcher.py`](../../code/desktop/launcher.py) | 真正的 launcher：单实例、PostgreSQL、迁移、FastAPI、pywebview、退出清理 |

首次启动会：

1. 校验 `vendor/pgsql` 与 pgvector 文件；
2. `initdb` 到 `%LOCALAPPDATA%\MindMeter\pgdata`；
3. 生成随机 `mm_admin` / `mm_app` 密码，存 Windows Credential Manager；
4. 启动 PostgreSQL（`127.0.0.1` + 随机端口）；
5. `CREATE EXTENSION vector`；
6. 迁移前 `pg_dump`（已有数据时）；
7. `alembic upgrade head`；
8. 启动 FastAPI（`127.0.0.1` + 随机端口）；
9. 打开 pywebview 窗口。

第二次启动复用 `pgdata`，不会重复 initdb。

## 目录

```text
vendor/pgsql/                    # 便携版 PostgreSQL + pgvector，gitignored
%LOCALAPPDATA%\MindMeter\
├─ pgdata\                       # 数据库数据
├─ backups\                      # pg_dump -Fc
├─ logs\                         # launcher.log / backend.log / postgres.log
├─ models\                       # fastembed 模型缓存
└─ runtime\                      # 启动期临时文件
```

仓库根目录的 `runtime/` 只用于开发/测试，也会被 gitignore。

如果 `%LOCALAPPDATA%` 被 ACL/沙箱限制导致 `initdb` 无法改权限，launcher 会自动回退到
`<repo>\runtime\data`，并在 `launcher.log` 记录。正常桌面环境优先使用 `%LOCALAPPDATA%`。

## 便携版下载

- PostgreSQL 17.12 Windows x64：
  [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries) → “Binaries from installer Version 17.12” → Windows x86-64。
  解压到 `vendor/pgsql/`，确认 `vendor/pgsql/bin/initdb.exe` 存在。
- pgvector 0.8.6 for PostgreSQL 17：
  [社区预编译包](https://github.com/andreiramani/pgvector_pgsql_windows/releases/tag/0.8.6_17)。
  - `lib/vector.dll` → `vendor/pgsql/lib/`
  - `share/extension/vector*` → `vendor/pgsql/share/extension/`
  - 校验 SHA256：`420388e9e9f05d92f06d6967ce8772483629b27a66ca9255925fa0fdd445438e`

不要把 `vendor/` 提交到 git。安装包构建时再下载/打包。

## 手动启动（开发）

```powershell
$env:PYTHONPATH = "$PWD\code"
python -m desktop.launcher
# 只启动后端（不打开窗口）：
python -m desktop.launcher --no-window --backend-port 8765 --pg-port 55432
```

后端测试（需要便携 PostgreSQL 已启动）：

```powershell
python -m desktop.launcher --no-window --backend-port 8767 --pg-port 55435
# 另开终端：
$pw = python -c "import keyring; print(keyring.get_password('MindMeter','pg-app'))"
$env:MM_TEST_DATABASE_URL = "postgresql+psycopg://mm_app:$pw@127.0.0.1:55435/mindmeter"
python -m pytest -q tests/backend -rs
```

健康检查：

```powershell
curl.exe -H "X-MM-Token: <token>" http://127.0.0.1:<port>/api/v1/health
```

token 来自 pywebview bridge 或测试环境变量；生产不写入 URL、localStorage、日志。

## 迁移与备份

```powershell
# launcher 自动执行；手动执行时：
$env:MM_MIGRATION_DATABASE_URL = "postgresql+psycopg://mm_admin:<pw>@127.0.0.1:<port>/mindmeter"
python -m alembic -c code/backend/alembic.ini upgrade head

# 备份
vendor\pgsql\bin\pg_dump.exe -Fc -h 127.0.0.1 -p <port> -U mm_admin -d mindmeter -f backup.dump
# 恢复
vendor\pgsql\bin\pg_restore.exe -d mindmeter backup.dump
```

迁移前备份失败会中止启动，不会在无备份情况下跑迁移。

## 退出顺序

窗口关闭 → 停止 FastAPI → `pg_ctl stop -m fast` → 关闭 Job Object → 释放单实例锁。

launcher 被强制结束时，Windows Job Object（`KILL_ON_JOB_CLOSE`）会杀掉子进程；PostgreSQL 下次启动自动 WAL 恢复。

## 安全

- FastAPI/PostgreSQL 只监听 `127.0.0.1`；
- 所有 `/api/v1/*` 需要 `X-MM-Token`；
- 拒绝非 loopback Host 与跨源 Origin；
- LLM Key 只在 Windows Credential Manager；
- DB 密码也在 Credential Manager；
- 日志脱敏，不记录 prompt/回答/Key；
- 导出 JSON 不含 Key；
- `pg_hba.conf` 仅 `127.0.0.1/32 scram-sha-256`。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 启动失败，提示缺 `initdb.exe` | 按上面下载 PostgreSQL，解压到 `vendor/pgsql/` |
| 提示缺 `vector.control` | 把 pgvector 的 `share/extension` 与 `lib/vector.dll` 放好 |
| `initdb` 失败 | 看 `%LOCALAPPDATA%\MindMeter\logs\launcher.log`；确认路径无权限问题 |
| 窗口打开但显示“本地服务没有启动” | 看 `logs/backend.log`；确认 8000/8765 未被占用 |
| 模型不可用 | `rag` 显示 `keyword` 是正常降级；把模型缓存放到 `%LOCALAPPDATA%\MindMeter\models` 或联网首次下载 |
| 端口占用 | launcher 用随机端口；开发时用 `--backend-port` / `--pg-port` 指定 |
| Key 清除后仍显示已保存 | 重启窗口；确认 Windows Credential Manager 中 `MindMeter/llm-api-key` 已删除 |
