# Tests（M1 本地 + L2 目标）

## 分层

| 目录/类型 | 范围 | 现状 |
| --- | --- | --- |
| `npm run lint` / `npm run format:check` | ESLint + Prettier（scripts + frontend） | 可运行 |
| `npm run complexity` | 圈复杂度/函数长度/嵌套/参数报告 | 可运行（warn） |
| `scripts/check_docs.py` | 必需文件/目录、冲突标记、相对链接、重复文件、提交文件 | 可运行 |
| `scripts/check_secrets.py` | 疑似 Key/token/私钥/带密码 DB URL | 可运行 |
| `scripts/test_prototype.js` | L1 原型 JS 语法、DOM id、三档流程、无 ASR 分支、清除数据 | 可运行 |
| `scripts/test_storage.js` | L-03 本地存储：四类 key、schemaVersion、draft 过期、导出不含 Key、降级 | 可运行 |
| `tests/backend/` | FastAPI 健康检查 + OpenAPI 核心路径契约 | L2 目标；后端未搭建时 skip |
| `tests/unit/` | M1 本地计分/校验；L2 服务端公式 | M1 起补充 |
| `tests/integration/` | 本地：打开→4 项→报告→对话→趋势；L2：注册→… | M1 起补充 |
| `tests/e2e/` | 浏览器关键路径（Playwright） | 可运行；`npm run test:e2e` |
| `tests/ai_eval/` | 30 条 Agent + 20 条 RAG | M1 起补充 |

## 本地命令

```bash
npm ci
npm run check          # ESLint + Prettier + 5 套测试
npm run test:e2e       # Playwright Chromium 浏览器 E2E

python scripts/check_docs.py
python scripts/check_secrets.py
python scripts/export_issues.py --check

# 后端已有 code/backend/pyproject.toml（或 requirements.txt）时：
pytest -q tests/backend -rs

# 如未安装测试依赖：
python -m pip install pytest httpx fastapi
```

Windows PowerShell 同样适用；Node 24+、Python 3.13+。

## CI

| Workflow | 内容 |
| --- | --- |
| `.github/workflows/structure-check.yml` | 文档/链接/冲突/重复/提交文件/issues.csv 同步 |
| `.github/workflows/ci.yml` | Node 24 lint/format/prototype、后端契约（有 pyproject 才跑）、secret scan |

后端 job 在 `code/backend/pyproject.toml` 出现前会跳过，并输出 notice；出现后如果缺 `app/main.py` 会直接失败，不会静默跳过。

## 测试数据

- 只用合成数据，不提交真实用户作答/对话；
- 固定输入/期望输出；计分金标准用例；
- AI 评测集固定版本，改动需评审；
- 明确断言：不产生总分/均分/百分位；未测维度为 `null`。

## 验收底线

- 注册→标准 4 项→报告→对话→记忆→复测→趋势跑通；
- 服务端计分与金标准一致；重复提交幂等；
- 无总分/常模/百分位；未测显示“未测”；
- AI 失败回退模板；禁用词 0；幻觉数字 0；
- 删除账号 30 天内清除；导出不含 Key；
- 备份恢复至少 1 次。
