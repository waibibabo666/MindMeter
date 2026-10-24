# MindMeter 文档索引

> 当前口径：**8 项能力 / 三档（5–13–28 分钟）/ 不设总分 / 无账号 / BYOK AI**。2026-10-24 之后的文档以本索引标注的“当前”为准；标“历史”的只用于追溯。

## 核心文档

| 目录 | 文档 | 状态 | 说明 |
| --- | --- | --- | --- |
| `requirements/` | [问题定义与产品描述](requirements/problem_definition.md) | 当前 v2.0 | 5W1H、定位、竞品、产品定义、MVP |
| `requirements/` | [功能需求规范](requirements/functional_spec.md) | 当前 v2.0 | 8 项任务、三档、报告、数据、验收 |
| `requirements/` | [非功能需求规范](requirements/nonfunctional_spec.md) | 当前 v2.0 | 性能、兼容、隐私、ASR、科学底线 |
| `requirements/` | [Agent 设计](requirements/xlragentdesign.md) | 当前 v2.0 | AI 核心三项、BYOK、降级 |
| `algorithm/` | [算法设计](algorithm/algorithm.md) | 当前 v3.0 | 8 个任务公式、`scoring-v3`、无总分 |
| `software/` | [技术方案](software/architecture.md) | 当前 v3.0 | 原生前端、静态托管、数据模型、排期 |
| `software/` | [软件设计](software/software.md) | 当前 v2.0 | 模块总览与目录（细节见技术方案） |
| `research/` | [用户故事](research/user_stories.md) | 当前 v2.0 | 12 条故事、Gherkin 验收 |
| `software/prototype/` | [原型说明](software/prototype/prototype.md) | 当前 v5 | 三档、8 任务、4 款补充练习 |
| `software/prototype/` | [AI 接入位](software/prototype/agent-接入位.md) | 当前 v2.0 | BYOK 契约、降级、隐私 |
| `mgmt/` | [沟通管理计划](mgmt/communication_mgmt_plan.md) | 当前 v1.1 | 4 人分工、每周节奏、决策与升级 |
| `mgmt/` | [风险管理计划](mgmt/risk_mgmt_plan.md) | 当前 v1.1 | 12 项风险、重点应对与跟踪 |
| `retrospection/` | [复盘模板](retrospection/retrospection.md) | 模板 | 每周/里程碑复盘记录 |

## 历史调研（只作追溯）

| 文档 | 说明 |
| --- | --- |
| [认知测量框架](research/rengzhi.md) | 常模/百分位/±6 分建议未被采纳 |
| [维度与分档调研 v2](research/xlrdimensions_v2.md) | 4/7 维、总分、三档旧口径 |
| [四维口径调研 v0.9](research/xlrweidudiaoyan.md) | “四项不换、不增加总时长”旧结论 |
| [Agent 平台调研](research/xlragentplatform.md) | 平台对比；serverless 结论不再采用 |
| [requirements/xlrweidudiaoyan.md](requirements/xlrweidudiaoyan.md) | 已合并，只剩指向 research 的指针 |

> 历史文档顶部均有“已被 8 维决策取代/未采纳”的横幅；不要用它们反推当前需求。

## 说明

- 文档版本以各文首信息表为准；
- 当前 8 维是 2026-10-24 团队拍板的产品口径，不是学界公认的“8 种智力”；
- 本期不测工作记忆、抑制控制、认知灵活性；报告必须写明；
- 不设总分、没有常模、不做百分位、不给误差范围；
- 旧版“4 维 / 15 分钟 / 账号后端 / serverless”文档已被取代，只保留在 git 历史与历史调研中。
