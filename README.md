# MindMeter（心智镜）

> 玩一局，看清你的大脑 —— 测得出，也练得进。

MindMeter 是一个 **4 人 / 6 周**的课程项目：用 4 个 2–4 分钟的小游戏，在 15 分钟内给出工作记忆、抑制控制、加工速度、情景记忆四个维度的认知画像和行动建议，并支持本地复测对比。

> 本项目不是医疗器械，不提供临床诊断、治疗或危机干预；结果仅用于自我了解和课程演示。

## 团队

| 成员 | 角色 | 主要职责 |
| --- | --- | --- |
| waibibabo666 | 项目负责人 | 进度、分工、风险、答辩 |
| xlr268 | 产品负责人 | 需求、用户测试、报告文案 |
| song | 技术负责人 | 前端、游戏实现、部署 |
| 1213lz | 技术/计分 | 计分逻辑、数据处理、测试 |

## 六周计划

| 周次 | 目标 | 交付物 |
| --- | --- | --- |
| W1 | 需求与测量方案 | 需求/设计/管理文档、4 个游戏规则 |
| W2 | 原型与视觉 | 页面流程、原型、技术选型 |
| W3 | 核心游戏开发 | 4 个游戏可玩、计分模块 |
| W4 | 报告与联调 | 雷达图、建议、历史记录 |
| W5 | 测试与试用 | 10–15 人测试、缺陷修复 |
| W6 | 发布与答辩 | 线上版本、演示视频、答辩材料 |

## 文档

| 文档 | 说明 |
| --- | --- |
| [问题定义与产品描述](docs/requirements/problem_definition.md) | 5W1H、使命/口号、目标用户、竞品、SWOT、产品定义 7 项 |
| [功能需求规范](docs/requirements/functional_spec.md) | 4 个游戏规则、计分、报告、数据与验收标准 |
| [非功能需求规范](docs/requirements/nonfunctional_spec.md) | 性能、兼容、隐私、科学性与 6 周质量底线 |
| [算法设计](docs/algorithm/algorithm.md) | 四个游戏的指标、0–100 计分公式与版本 |
| [软件设计](docs/software/software.md) | 前端、计分模块、本地存储与静态部署 |
| [沟通管理计划](docs/mgmt/communication_mgmt_plan.md) | 4 人分工、每周节奏、渠道、决策与升级 |
| [风险管理计划](docs/mgmt/risk_mgmt_plan.md) | 12 项风险、重点应对、跟踪与应急 |
| [复盘模板](docs/retrospection/retrospection.md) | 每周/里程碑复盘记录 |

课程提交版摘要：

- [作业 1：使命、口号与产品策略](work_for_submission/1.md)
- [作业 2：产品定位与产品定义](work_for_submission/2.md)
- [作业 3：沟通管理与风险管理计划](work_for_submission/3.md)

## 仓库结构

```text
MindMeter/
├─ docs/
│  ├─ README.md                 # 文档索引
│  ├─ requirements/             # 问题定义、功能、非功能
│  ├─ algorithm/                # 4 个游戏的计分设计
│  ├─ software/                 # 前端、计分模块、存储与部署
│  ├─ mgmt/                     # 沟通与风险管理
│  └─ retrospection/            # 复盘模板
├─ code/
│  ├─ backend/                  # 本期不启用，保留未来同步/账号
│  ├─ frontend/                 # 页面、4 个游戏、报告
│  └─ core_engine/              # 纯函数计分模块
├─ tests/
│  ├─ unit/                     # 计分公式单测
│  └─ integration/              # 完整流程测试
├─ .github/workflows/           # 项目结构检查
├─ work_for_submission/         # 课程提交版 1/2/3
└─ README.md
```

目录说明：

| 目录 | 用途 |
| --- | --- |
| `code/frontend` | 首页、同意页、4 个游戏、报告、历史 |
| `code/core_engine` | 计分公式与阈值配置，不操作 DOM |
| `code/backend` | 本期空目录，不做后端 |
| `tests/unit` | 计分正常/边界/缺失用例 |
| `tests/integration` | 4 个游戏到报告的完整流程 |
| `.github/workflows` | push/PR 时检查文档和目录是否齐全 |

## 本期范围

**做**：4 个游戏化测评、四维画像、雷达图、2–3 条建议、本地历史与复测、数据清除、移动端 Web。

**不做**：账号登录、支付、运营后台、AI 解读、自适应测评、临床常模、社区、原生 App。

## 当前状态

项目目录与文档结构已搭好，代码尚未开始。W2 确定技术栈后，在 `code/frontend` 和 `code/core_engine` 落地，并在 README 补充启动说明。

## 原则

- 6 周只做减法：新增一个功能，先删一个同等工作量的功能；
- 每周五必须有可运行版本，不演示 PPT；
- 不伪造常模和效度数据，报告明确标注“课程演示参考分、非常模、非临床”；
- 不收集姓名、手机号等身份信息，测评数据默认只存在用户本地。
