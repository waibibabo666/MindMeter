# L1 原型骨架（UI 参考）

> **状态：L1 历史原型，不是 L2 最终实现。**
> L2 已改为“账号 + FastAPI + 服务端计分 + LangGraph Agent + 记忆 + RAG”。本目录的 `index.html` 只保留为三档流程、8 任务入口、八维报告和对话/记忆 UI 的参考；不要把它当作 L2 架构或计分依据。

## 目录

```text
prototype/
├─ index.html              L1 本地骨架（无账号/无后端/本地 BYOK）
├─ prototype.md            本文件：L1 说明与 L2 差异
├─ agent-接入位.md         L2 前端→后端 Agent 契约
└─ 页面流程图v4_legacy.png 旧版流程图（含 8 游戏旧方案，仅参考）
```

## L1 演示了什么

- 三档：快测 2 项 / 标准 4 项 / 深度 8 项；
- 8 个任务入口与顺序；
- 八维报告（无总分）；
- 本地历史、任务边界 draft、设置、4 款练习入口；
- 本地 BYOK 设置（L2 不再由前端直连模型）。

## L1 → L2 的关键差异

| 项 | L1 原型 | L2 目标 |
| --- | --- | --- |
| 账号 | 无 | 邮箱 + 密码 + JWT |
| 计分 | 浏览器 JS（演示） | 服务端 Python，唯一权威 |
| 数据 | localStorage | PostgreSQL |
| AI | 浏览器直连 BYOK | 后端 LangGraph + BYOK 加密存库 |
| 记忆 | 无/最近几条 | 20 条 + 画像/摘要/建议 |
| RAG | 无 | pgvector + 本地 embedding |
| 趋势 | 本地历史 | 服务端共同维度趋势 + Agent 解释 |
| 练习 | 4 款占位 | P2，可延期 |

## L2 参考

- [技术方案](../../software/architecture.md)
- [Agent 设计](../../requirements/xlragentdesign.md)
- [功能需求](../../requirements/functional_spec.md)

## 运行 L1

直接双击 `index.html`；无需构建。只是 UI 参考，不代表 L2 可运行版本。

## 已知限制

- 任务内部是演示/占位逻辑，不是最终计分；
- 无账号、无服务端、无记忆/RAG；
- 4 款练习只有入口；
- ASR 仅 Chrome/Edge；
- 页面流程图 v4 是旧图，含 8 游戏旧方案，仅参考。

## 免责声明

MindMeter 不是医疗器械，不提供诊断、治疗或医疗建议。原型中的分数仅用于演示交互流程，不代表真实能力。
