# AI（L1 历史）

> L2 起，Agent 在 `code/backend/app/agent/`（LangGraph），RAG 在 `code/backend/app/rag/`。
> 本目录只保留 L1 的 BYOK 直连契约说明，作为历史参考。

## L2 位置

- Agent 设计：[docs/requirements/xlragentdesign.md](../../docs/requirements/xlragentdesign.md)
- 技术方案：[docs/software/architecture.md](../../docs/software/architecture.md)
- 后端 Agent：`code/backend/app/agent/`
- RAG：`code/backend/app/rag/`

## L1 历史

L1 是“浏览器直连 BYOK、无后端”；L2 改为“后端代理 + BYOK 加密存库 + LangGraph + RAG + 记忆”。L1 契约不再作为实现依据。
