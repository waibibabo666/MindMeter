# Core Engine（L1 历史）

> L2 起，计分迁移到 `code/backend/app/scoring/`，由服务端 Python 唯一权威计算。
> 本目录的 JS 计分只保留为 L1 原型/回归对照，不参与 L2 计分。

## L2 计分位置

- 公式与阈值：[docs/algorithm/algorithm.md](../../docs/algorithm/algorithm.md)
- Python 实现：`code/backend/app/scoring/`
- 版本：`scoring-v3`
- 规则：8 维、无总分、无常模、无百分位；缺失返回 `null`。

## L1 历史

L1 的 `scoring.js`/`config.js` 曾用于静态原型；L2 不再使用。若保留，只用于对照金标准，不得作为线上结果。

