# Integration tests（后端契约）

Use a disposable PostgreSQL/pgvector database; never SQLite. The suite is
cookie-authenticated: `client` is anonymous, `logged_client` shares one
account, and `fresh_client` / `register_account()` mint a second one for
tenancy checks.

```powershell
# 1) 起一个一次性库（便携版，trust 认证，仅回环）
python scripts/e2e_server.py           # 会自建 runtime/e2e 集群并跑迁移（服务在 :8100）

# 2) 或者手工：用已有的 pgvector 库，先迁移再跑测试
python -m alembic -c code/backend/alembic.ini upgrade head
$env:MM_TEST_DATABASE_URL = "postgresql+psycopg://mm_test@127.0.0.1:55450/mindmeter_test"
pytest -q tests/unit tests/integration -rs
```

没有 `MM_TEST_DATABASE_URL` 时，需要数据库的用例自动 skip；纯逻辑用例（口令散列、计分金标准、Agent 图、模板文案）照常运行。

Covered:

- `test_auth_api.py`：PBKDF2 散列与校验、用户名/密码规则、注册（Cookie 属性、重名 409、18+ 勾选、弱密码文案）、登录失败统一 401、限流 429、改密码撤销其他设备、注销账号后用户名可复用；
- `test_tenancy.py`：同一 `id` 在两个账号下互不冲突、越权读取 404、`/state`/记忆/对话/导出/清除都只作用于本账号、每账号 50 次上限；
- `test_health_contract.py`：liveness 不碰 DB、readiness 报迁移与 pgvector、静态首页免登录、安全头、`Cache-Control: no-store`、跨源写 403、非 JSON 体 415、可关闭注册；
- `test_openapi_contract.py`：公开面与鉴权面清单，确认没有 JWT/refresh/管理端接口，文档路由关闭；
- `test_api_smoke.py`：作答→服务端计分→导出无密钥、记忆替换、对话模板兜底、AI 设置只读；
- `test_agent_workflow.py` / `test_agent_chat.py` / `test_agent_trend_api.py`：分类、场景策略、派生数字白名单、统一出口与趋势联动（用假 `site_llm_config`，不需要真实 Key）；
- `test_scoring_golden.py` / `test_template_narrative.py` / `test_trend_assembly.py`：计分金标准与模板文案。

For CI, start `pgvector/pgvector:pg17` and set `MM_TEST_DATABASE_URL`（见 `.github/workflows/ci.yml`）。
