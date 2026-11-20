# ADR-0003：Web 账号体系与 Render 托管部署

- 状态：已接受（Accepted）
- 日期：2026-11-19
- 负责人：song
- 取代：`docs/adr/0001-local-desktop-runtime.md` 的第 1/2/6/7 条（桌面壳、loopback token、单用户、keyring Key 存储）；其余条款（PostgreSQL + pgvector + Alembic + LangGraph + 模板兜底 + 不用 SQLite）继续有效
- 关联：[Render 部署指南](../software/deploy-render.md)、[Web 本地开发与测试](../software/local-development.md)、[功能需求 §5.1](../requirements/functional_spec.md)、[非功能需求](../requirements/nonfunctional_spec.md)

## 背景

课程项目要变成一个可以直接发给别人用的标准 Web 应用，部署到 Render：

- 任何人用浏览器访问，不再有“这台电脑才是你的数据”的前提；
- AI 能力统一用发起人提供的 LLM API，不再让每个用户自己填 Key；
- 多用户必须保证数据隔离，否则“记忆/对话/复测趋势”这些核心卖点会互相污染；
- 功能需求 §5.1 早就写了 F-01～F-06（注册、登录、会话、注销、导出），桌面版没有实现。

## 决策

1. **部署形态**：单个 Render Web Service 同源提供 `/api/v1/*` 与前端静态文件；不使用单独的前端服务、不引入 CORS。
2. **账号凭证**：用户名 + 密码。不收集邮箱、手机号、姓名（延续隐私原则“不收集身份信息”，也免去邮件依赖），因此**不提供自助找回密码**，登录页与设置页都写明了这一点。
3. **口令存储**：标准库 `hashlib.pbkdf2_hmac("sha256")`，240 000 轮、16 字节随机盐，格式 `pbkdf2-sha256$<轮数>$<盐>$<散列>`；比较用 `hmac.compare_digest`；用户名不存在时也走一次 PBKDF2，避免用响应时间枚举账号。
   - 密码规则：≥10 位（沿用 F-01）、≤128、至少含字母与数字、不得只有 1–2 种字符。前后端同一套口径，前端只做即时提示，**服务端才是边界**。
4. **会话**：随机 256-bit 令牌放 `HttpOnly`、`SameSite=Lax`、`Path=/` 的 Cookie；数据库只存 `sha256(token)`；有效期 30 天并滑动续期；登出/改密码/注销账号都会撤销服务端会话行。
   - **不采用 JWT**：没有无状态收益（单机单库），却带来撤销与密钥管理负担；功能需求里的 JWT 口径由“服务端会话 + Cookie”等价替代。
   - **不使用 pywebview 桥**：`window.__MM_BOOT__`、`X-MM-Token` 与桌面启动路径已从 `api.js` 删除；浏览器里不留任何令牌概念（2026-11-20 清理）。
5. **CSRF**：`SameSite=Lax` + 同源 Origin/Referer 校验 + 写请求必须 `application/json`（跨站表单发不出这个 Content-Type）。
6. **多租户数据模型**：所有业务表以 `user_id` 为复合主键的第一列——`app_state(user_id)`、`assessments(user_id,id)`、`assessment_tasks/scores(user_id,assessment_id,…)`、`memory_profile(user_id)`、`memory_summaries/advice/chat_messages(user_id,id)`；`kb_chunks` 仍是全站共享只读；`ai_runs/audit_log` 带可空 `user_id`。
   - 客户端生成的 id（`s_xxx`、`msg_xxx`、`kb-plan-01`）**只在账号内唯一**，不同账号可以重复，因此不需要改写前端 id 规则，也不需要命名空间前缀。
   - 老桌面库不做自动搬迁：迁移 `0004_hosted_copy` 检测到没有 `users` 表就报错并给出重建指引。
7. **AI 能力**：站点级环境变量 `MM_LLM_BASE_URL` / `MM_LLM_MODEL` / `MM_LLM_API_KEY`（OpenAI 兼容 `/chat/completions`）。
   - 删除 `keyring_store.py` 与 `ai_settings` 表：Key 不进数据库、不进浏览器、不进日志与导出。
   - `GET /settings/ai` 只读返回 `endpoint/model/enabled/hasKey/keyHint/managedBy/readOnly`；`PUT /settings/ai` 与 `DELETE /settings/ai/key` 一律 403 `ai_managed_by_site`。
   - 未配置或失败时**保持原有分级兜底**：模板解读、`code=not_configured`，页面不空白、分数不变。
8. **检索**：部署默认 `MM_RAG_MODE=keyword`（BM25）。可选的本地 embedding 模型（约 100 MB）与免费实例的临时文件系统、冷启动、磁盘配额冲突，因此不进 Web 依赖。
9. **健康检查**：`/api/v1/health/live`（不碰数据库，供平台探活）与 `/api/v1/health`（就绪：DB + 迁移号 + pgvector + RAG + AI 配置状态，公开、不含用户数据）。
10. **桌面版彻底删除**（2026-11-20 清理）：`code/desktop/`、`MindMeter.cmd`、`MindMeter.vbs`、`docs/software/local-runtime.md` 全部移除；同时删掉前端里浏览器直连模型的 legacy（`src/llm/client.js`、`src/llm/degrade.js`、`src/agent/*`）与对应的历史测试脚本（`test_storage.js`、`test_llm_client.js`、`test_agent_run.js`、`test_eval.js`）。Web 是唯一形态，本地开发入口是 `python scripts/e2e_server.py`，见 [本地开发与测试](../software/local-development.md)。

## 后果

- 数据归属从“设备”变成“账号”：文案与知识库条目 `kb-limit-04` 同步改写（见 0004 迁移）。
- 免费实例会冷启动（首个请求约 1 分钟）、文件系统临时、免费 Postgres 30 天后过期；部署文档给出升级 `starter` 的一步操作。
- 注册可被 `MM_ALLOW_REGISTRATION=false` 关闭（答辩现场控制用量），登录按 `IP+用户名` 限流、注册按 IP 限流。
- 注销账号是硬删除 + `ON DELETE CASCADE`，满足“删除后不可恢复、导出不含 Key”；30 天缓冲期由 Render 的每日备份代替，文档写明。
- 测试体系换轨：`tests/backend` 走 Cookie 会话（`logged_client` / `fresh_client`），新增 `test_auth_api.py`、`test_tenancy.py`；E2E 直接注册/登录，不再注入 token。

## 不采用

- 浏览器直连模型、BYOK 输入框（哪怕“只是自己用”）；
- JWT / 把令牌存 localStorage；
- 邮箱验证码、第三方 OAuth（课程周期内不做，接口预留不影响后续加）；
- 为多租户引入 Redis / 独立向量库 / 每用户一个 schema；
- 把 `.env`、密钥或真实用户数据提交进 git。

## 验收

见 [Render 部署指南](../software/deploy-render.md) §验收清单；自动化对应 `tests/backend/test_auth_api.py`、`tests/backend/test_tenancy.py`、`scripts/smoke_web_deploy.py`。
