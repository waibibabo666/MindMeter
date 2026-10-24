# MindMeter（心智镜）

> 玩一局，看清你的大脑 —— 测得出，也练得进。

MindMeter 是一个 **4 人 / 6 周**的课程项目：用 8 个短任务，在 **快测 5 分钟（2 项）/ 标准 13 分钟（4 项）/ 深度 28 分钟（8 项）** 中给出言语理解、言语流畅性、数字运算、知觉速度、归纳推理、空间视觉化、联想记忆、自然探索的八维参考分，并支持本地复测对比。

> 本项目不是医疗器械，不提供临床诊断、治疗或危机干预；结果仅用于自我了解和课程演示。**不设总分、没有常模、不做百分位、不与人群比较。**

## 团队

| 成员 | 角色 | 主要职责 |
| --- | --- | --- |
| waibibabo666 | 项目负责人 | 进度、分工、风险、答辩 |
| xlr268 | 产品负责人 | 需求、用户测试、报告文案 |
| song | 技术负责人 | 前端、任务实现、部署 |
| 1213lz | 技术/计分 | 计分逻辑、数据处理、测试 |

## 六周计划

| 周次 | 目标 | 交付物 |
| --- | --- | --- |
| W1 | 需求与测量方案 | 8 项任务定义、三档规则、计分口径 |
| W2 | 原型与视觉 | 页面流程、v5 原型骨架、技术选型 |
| W3 | 快测 + 标准 | 快测 2 项、标准 4 项、计分模块 |
| W4 | 深度 + 报告 | 深度档补齐 4 项、八维雷达图、建议、历史 |
| W5 | BYOK、ASR 调优、测试 | 10–15 人试用、缺陷修复、AI/ASR 验证 |
| W6 | 发布与答辩 | 线上版本、演示视频、答辩材料 |

> 8 项任务全部做完风险很高；若 W4 深度档未完成，答辩演示快测 + 标准档，深度档标“后续版本”。这是允许的取舍，但必须提前说明。

## 文档

| 文档 | 说明 |
| --- | --- |
| [问题定义与产品描述](docs/requirements/problem_definition.md) | 5W1H、使命/口号、目标用户、竞品、SWOT、产品定义 |
| [功能需求规范](docs/requirements/functional_spec.md) | 8 项任务、三档、计分、报告、数据、验收 |
| [非功能需求规范](docs/requirements/nonfunctional_spec.md) | 性能、兼容、隐私、ASR、科学性底线 |
| [算法设计](docs/algorithm/algorithm.md) | 8 个任务的指标、0–100 公式、`scoring-v3` |
| [技术方案](docs/software/architecture.md) | 原生前端、静态托管、BYOK、ASR、数据模型 |
| [软件设计](docs/software/software.md) | 模块总览与目录 |
| [用户故事](docs/research/user_stories.md) | 12 条 INVEST 故事与 Gherkin 验收 |
| [Agent 设计](docs/requirements/xlragentdesign.md) | AI 核心三项：报告解读、追问、复测解释 |
| [原型说明](docs/software/prototype/prototype.md) | v5 原型骨架、三档、8 任务、4 款补充练习 |
| [AI 接入位](docs/software/prototype/agent-接入位.md) | BYOK 契约、降级、隐私检查 |
| [沟通管理计划](docs/mgmt/communication_mgmt_plan.md) | 4 人分工、每周节奏、决策与升级 |
| [风险管理计划](docs/mgmt/risk_mgmt_plan.md) | 12 项风险、重点应对与跟踪 |
| [复盘模板](docs/retrospection/retrospection.md) | 每周/里程碑复盘记录 |

研究文档（历史参考，部分结论已被 8 维决策取代）：

- [认知测量框架](docs/research/rengzhi.md)
- [维度与分档调研 v2](docs/research/xlrdimensions_v2.md)
- [四维口径调研 v0.9](docs/research/xlrweidudiaoyan.md)
- [Agent 平台调研](docs/research/xlragentplatform.md)

课程提交版：

- [作业 1：使命、口号与产品策略](<work_for_submission/苏打F4_MindMeter_assignment[1]_rev.md>)
- [作业 2：产品定位与产品定义](<work_for_submission/苏打F4_MindMeter_assignment[2]_rev.md>)
- [作业 3：沟通管理与风险管理计划](<work_for_submission/苏打F4_MindMeter_assignment[3]_rev.md>)

## 仓库结构

```text
MindMeter/
├─ docs/
│  ├─ README.md                 # 文档索引
│  ├─ requirements/             # 问题定义、功能、非功能、Agent 设计
│  ├─ research/                 # 历史调研、用户故事
│  ├─ algorithm/                # 8 个任务的计分设计
│  ├─ software/                 # 技术方案、软件设计
│  │  └─ prototype/             # v5 原型骨架、流程图、AI 接入位
│  ├─ mgmt/                     # 沟通与风险管理
│  └─ retrospection/            # 复盘模板
├─ code/
│  ├─ backend/                  # 本期不启用
│  ├─ frontend/                 # 页面、8 个任务、报告
│  ├─ core_engine/              # 纯函数计分模块
│  └─ ai/                       # BYOK 契约，无服务端
├─ tests/
│  ├─ unit/                     # 计分公式单测
│  └─ integration/              # 三档完整流程
├─ .github/workflows/           # 项目结构与链接检查
├─ work_for_submission/         # 课程提交版 1/2/3
└─ README.md
```

## 本期范围

**做**：8 项能力任务、快测/标准/深度三档、八维雷达图、2–3 条建议、本地历史与复测、数据清除、任务边界断点恢复、可选 BYOK AI 解读/追问/复测解释、4 款补充练习（P2）。

**不做**：账号登录、支付、运营后台、自建后端、云数据库、常模、百分位、总分、临床诊断、AI 判分/选维度、自适应测评、两周计划、理解度复盘、AI 自检、社区、排行榜、原生 App、多语言、B 端/付费。

> 本期不测工作记忆、抑制控制、认知灵活性；报告会在局限说明中写清。8 项是产品口径，不是学界公认的“8 种智力”。

## 当前状态

- 核心文档已统一到 8 维/三档（需求 v2.0、算法/技术 v3.0）；两份规格书的 Git 冲突已清除；
- 原型 v5 骨架在 `docs/software/prototype/index.html`：三档流程、8 任务入口、八维报告、历史、设置可走通；任务内部为演示逻辑；
- 产品代码尚未开始；下一步按 [技术方案](docs/software/architecture.md) 在 `code/` 落地；
- 旧调研（4/7 维、常模、总分、serverless）保留为历史参考，不再作为实现依据。

## 启动

原型：直接双击 `docs/software/prototype/index.html`，无需构建。
正式代码：W2 确定目录后补充启动说明。

## 原则

- 6 周只做减法：新增一个功能，先删一个同等工作量的功能；
- 每周五必须有可运行版本，不演示 PPT；
- 不伪造常模、百分位、效度数据或误差范围；
- 不设总分，避免把不同能力结构的人压成一个数字；
- 不收集姓名、手机号等身份信息；测评数据默认只存在用户本地；
- AI 默认关闭；只有用户主动配置 BYOK 并同意后，才发送维度分与 facts。
