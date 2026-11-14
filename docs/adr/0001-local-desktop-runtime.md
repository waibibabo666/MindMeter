# ADR-0001：本地桌面运行时（pywebview + FastAPI + 便携 PostgreSQL + pgvector）

- 状态：已接受（Accepted）
- 日期：2026-11-14
- 负责人：song
- 取代：`docs/mgmt/m1_scope.md` 中“不做 FastAPI/Postgres/pgvector、静态托管”的旧范围
- 关联：[本地运行时](../software/local-runtime.md)、[技术方案](../software/architecture.md)、[测试说明](../../tests/README.md)

## 背景

M1 是浏览器 UI + localStorage + 浏览器直连 LLM API。这个实现适合演示，但不满足目标架构：

- 数据只在浏览器里，无法可靠备份/迁移/查询；
- LLM Key 存在 localStorage，XSS/公用设备风险高；
- 浏览器直连模型受 CORS 限制；
- 没有 PostgreSQL/pgvector，无法做本地 RAG 和后续记忆检索。

UI 已经冻结。本次是架构迁移，不是 UI 重做。

## 决策

1. **桌面壳**：pywebview 窗口加载 `http://127.0.0.1:<backend_port>/`，由 FastAPI 同源托管前端静态文件。
2. **后端**：FastAPI 独立子进程，uvicorn 只绑定 `127.0.0.1`，随机端口。
3. **数据库**：随应用分发 PostgreSQL 17.12 便携版 + pgvector 0.8.6；数据目录在 `%LOCALAPPDATA%\MindMeter\pgdata`。
4. **启动/停止**：只由 `code/desktop/launcher.py` 管理；FastAPI 的 import/lifespan 不启动数据库、不跑迁移。
5. **迁移**：Alembic；启动前 `pg_dump` 备份；迁移失败不启动后端。
6. **单用户/无账号**：没有 users/JWT/auth 表；本地 API 用每次启动生成的 `X-MM-Token`。
7. **Key**：只存 Windows Credential Manager（`keyring`）；数据库只存 `key_ref`/`key_hint`；前端、localStorage、日志、导出 JSON 都没有 Key。
8. **RAG**：30 条知识块进 PostgreSQL；本地 embedding（`BAAI/bge-small-zh-v1.5`，512 维）+ BM25 混合检索；无模型时只用 BM25。
9. **Agent**：LangGraph 小图（classify → retrieve → generate → validate），模型不可用/校验失败回退模板。
10. **不使用 SQLite**：测试也用 PostgreSQL（CI 用 `pgvector/pgvector:pg17` 服务）。

## 后果

- 安装包变大（PostgreSQL + Python + 可选 embedding 模型）；需要首次 initdb。
- 需要处理进程生命周期、随机端口、单实例、崩溃恢复。
- 旧 localStorage 数据通过“导出 JSON → 导入”迁移；Key 不迁移，需重新填写。
- `tests/backend/test_openapi_contract.py` 的 auth/JWT 路径被本地无账号 API 取代。
- `npm run check` 只跑前端/纯逻辑测试；后端测试用 `pytest`，E2E 用真实本地服务。

## 不采用

- 浏览器直连 LLM 的生产路径；
- 在 FastAPI import/lifespan 中启动数据库；
- 绑定 `0.0.0.0` 或无鉴权本地 API；
- SQLite 过渡方案；
- 把 PostgreSQL 二进制提交到 git。

## 验收

见 [本地运行时](../software/local-runtime.md) 与 [M1 范围](../mgmt/m1_scope.md) 的新验收表。
