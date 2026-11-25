# 代码评审

> 本仓库采用「`develop` 开发 → PR 回 `develop` → 评审 → 合入 `main` 自动部署」。
> `main` 受保护，必须走 PR 且 CI 通过。

## 1. 角色与流程

| 步骤 | 负责人 | 产物 |
| --- | --- | --- |
| 开分支 | 开发同学 | `feat/*` / `fix/*` / `docs/*` |
| 提 PR | 开发同学 | PR 描述：背景、改动、验证方式 |
| CI | GitHub Actions | 5 个 job 全绿 |
| 评审 | 负责人 + 相关同学 | 评审意见 / Approve |
| 合并 | 负责人 | 合入 `develop`（或 `main`） |

分支命名：`feat/…`、`fix/…`、`docs/…`、`refactor/…`、`test/…`。

## 2. 评审清单

### 2.1 正确性

- [ ] 分数、维度、趋势是否仍由服务端确定性计算？有没有在前端另算一套？
- [ ] 缺失数据是否返回 `null`，而不是按 0 分处理？
- [ ] 迁移是否可重复执行（`alembic upgrade head`）？

### 2.2 Agent / AI

- [ ] 新的模型输出是否经过 `agent/validation.py`（数字白名单、跨维度、机制词、评级词）？
- [ ] 安全意图（危机/越界/内容红线）是否仍走固定话术、不调用模型？
- [ ] 失败路径是否回退模板，而不是把异常抛给用户？

### 2.3 隐私与安全

- [ ] 是否引入新的敏感字段？导出/日志是否脱敏？
- [ ] 是否把 Key、密码、`.env` 写进仓库？
- [ ] 记忆写入是否遵守「敏感轮次不落记忆、画像需确认」？

### 2.4 测试与文档

- [ ] 新增行为是否有测试（后端 pytest / 前端纯逻辑 / E2E）？
- [ ] 是否更新 `scripts/check_docs.py` 的必检清单与文档索引？
- [ ] 是否更新 `CHANGELOG.md`（用户可见变化）？

## 3. 评审关注点（本项目特有）

| 风险 | 评审时看什么 |
| --- | --- |
| AI 编造数字 | `derived_allowed_numbers` / `dimension_score_owners` 是否覆盖新指标 |
| 评级/诊断措辞 | `BANNED_WORDS`、`ABILITY_RATING_WORDS`、`SCENE_POLICIES.extra_banned` |
| 引用造假 | `_citation_findings` 是否只认本轮真实知识块 |
| 记忆污染 | `insights.after_turn` 的 `SEDIMENT_INTENTS` 与隐私排除 |
| 成本 | 新增模型调用是否只在必要时发生（分类兜底、重试链） |

## 4. 相关文档

- 架构与分层：[architecture.md](architecture.md)
- 代码质量门禁：[code_quality.md](code_quality.md)
- Agent 设计：[agent-trend-workflow.md](agent-trend-workflow.md)、[ADR-0002](../adr/0002-agent-positioning-language-contract.md)
- 部署：[deployment.md](deployment.md)
