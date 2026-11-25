# 代码质量

> 本文说明本仓库的质量门禁、检查项与当前基线。CI 配置见
> [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)。

## 1. 本地门禁

```powershell
npm run check          # ESLint + Prettier + 12 套纯逻辑测试
npm run complexity     # 复杂度报告（warn，不阻塞）
python scripts/check_docs.py      # 结构 / 链接 / 重复文件 / 冲突标记
python scripts/check_secrets.py   # 密钥扫描
```

后端测试需要 pgvector Postgres：

```powershell
python scripts/e2e_server.py --db-only
$env:MM_TEST_DATABASE_URL = "postgresql+psycopg://..."   # 用上一条输出
python -m pytest -q tests/backend -rs
```

## 2. CI 检查项

| Job | 检查 | 失败后果 |
| --- | --- | --- |
| Prototype | lint、format、`npm test`（12 套） | 阻断合并 |
| Browser E2E | Playwright + pgvector 服务 | 阻断合并 |
| Backend | pytest 契约测试 + 迁移 | 阻断合并 |
| Secret scan | `scripts/check_secrets.py` | 阻断合并 |
| Docs & structure | `check_docs.py` + issues.csv 一致性 | 阻断合并 |

## 3. 代码风格约定

- **Python**：3.13、`from __future__ import annotations`、类型注解优先、纯函数放叶子模块；
- **前端**：原生 ES Module、无构建、无框架；样式集中在 `code/frontend/src/styles/`；
- **命名**：校验/渲染/编排分层（`agent/validation.py`、`agent/render.py`、`agent/graph.py`）；
- **错误**：AI 失败必须可降级到模板，不允许把异常栈抛给用户。

## 4. 当前基线

| 指标 | 数值 |
| --- | --- |
| 后端测试 | 327 passed / 80 skipped（DB 用例需 `MM_TEST_DATABASE_URL`） |
| 前端纯逻辑 | 12 套全绿 |
| Agent 离线评测 | 28 例：意图 100%、引用 100%、安全 10/10 |
| 文档检查 | 68 个必检文件、250 条链接 |

## 5. 质量红线

- 分数、维度、趋势**只能**由服务端确定性计算；
- 模型输出必须经过 `agent/validation.py` 的数字/引用/机制/评级校验；
- 不提交密钥（`.env.local` 已在 gitignore 内）；
- 新增文档/测试必须同步 `scripts/check_docs.py` 的必检清单。
