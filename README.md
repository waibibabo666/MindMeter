<<<<<<< HEAD
这是说明文件
欧克、
=======
# MindMeter

> 看见心智，量出成长。

[![Docs CI](https://github.com/waibibabo666/MindMeter/actions/workflows/docs-ci.yml/badge.svg)](https://github.com/waibibabo666/MindMeter/actions/workflows/docs-ci.yml)
[![Stage](https://img.shields.io/badge/stage-requirements%20v0.1-yellow)](docs/README.md)

MindMeter 是一款面向普通人的**在线心智测评与成长追踪工具**：用 15–20 分钟的轻量认知任务与自评量表，生成可解释的多维心智画像、可信度提示与纵向趋势，并给出可执行的成长建议。

当前仓库处于**需求定义阶段**：产品、功能、非功能与项目管理文档为 v0.1 草案，`code/` 与 `tests/` 尚未进入实现。

> [!WARNING]
> MindMeter 不是医疗器械，不提供临床诊断、治疗或危机干预。涉及自伤/自杀风险的内容仅提供求助资源指引，详见[功能规范](docs/requirements/functional_spec.md)与[风险管理计划](docs/mgmt/risk_mgmt_plan.md)。

## 文档索引

| 文档 | 编号 | 说明 | 状态 |
| --- | --- | --- | --- |
| [问题定义与产品描述](docs/requirements/problem_definition.md) | MM-REQ-001 | 5W1H 报告、使命/口号、产品策略、定位与 7 项产品定义 | 草案 v0.1 |
| [功能需求规范](docs/requirements/functional_spec.md) | MM-REQ-002 | 用户角色、功能需求 FR、业务规则、数据模型、接口与验收标准 | 草案 v0.1 |
| [非功能需求规范](docs/requirements/nonfunctional_spec.md) | MM-REQ-003 | 性能、可靠性、安全、隐私合规、可用性、可维护性等质量门槛 | 草案 v0.1 |
| [沟通管理计划](docs/mgmt/communication_mgmt_plan.md) | MM-PM-001 | 干系人、沟通矩阵、会议体系、升级与决策机制 | 草案 v0.1 |
| [风险管理计划](docs/mgmt/risk_mgmt_plan.md) | MM-PM-002 | 风险偏好、评估方法、风险登记册、KRI 与应急响应 | 草案 v0.1 |

完整文档规范、状态定义与 `【待定】` 标记约定见 [docs/README.md](docs/README.md)。

## 仓库结构

```text
MindMeter/
├─ .github/
│  ├─ workflows/docs-ci.yml      # Markdown 质量检查
│  └─ PULL_REQUEST_TEMPLATE.md
├─ code/
│  ├─ backend/                   # API、账号、数据与报告服务（待实现）
│  ├─ core_engine/               # 计分、常模、自适应测评与效度校验（待实现）
│  └─ frontend/                  # Web 客户端（待实现）
├─ docs/
│  ├─ README.md                  # 文档规范、状态与索引
│  ├─ requirements/              # 需求文档（问题定义、功能、非功能）
│  ├─ mgmt/                      # 项目管理文档（沟通、风险）
│  ├─ algorithm.md               # 算法设计（占位）
│  ├─ software.md                # 软件设计（占位）
│  └─ retrospection.md           # 复盘记录（模板）
├─ tests/
│  ├─ unit/
│  └─ integration/
├─ CHANGELOG.md
├─ CONTRIBUTING.md
├─ SECURITY.md
└─ README.md
```

## 参与贡献

1. 阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [文档规范](docs/README.md)。
2. 从 Issue 认领任务，创建 `feat/`、`fix/` 或 `docs/` 前缀分支。
3. 提交 PR 前自查：链接可点击、编号唯一、待定项已标注负责人、CI 通过。
4. 涉及产品范围、计分口径、隐私合规的变更，必须经对应决策人评审并记录在文档的「决策记录」中。

## 当前需要团队拍板的事项

- 产品中文名、口号终选与商标可用性
- 目标市场规模（TAM/SAM/SOM）与首批种子用户数量
- MVP 发布日期与各阶段里程碑日期
- 首批测评维度、量表来源与常模方案（需心理测量顾问签字）
- 数据存储地域、隐私合规责任人与法律意见
- 团队名单、分工、预算与协作工具

各文档末尾的「待决策事项」表列出了负责人与截止日期占位，评审会后补齐。

## 安全

如发现安全或隐私问题，请**不要**公开提交 Issue，按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

【待定】许可证类型（如 MIT / Apache-2.0 / 商业闭源）需团队与法务确认后补充 `LICENSE` 文件。
>>>>>>> origin/main
