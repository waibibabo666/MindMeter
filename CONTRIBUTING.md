# 贡献指南

感谢参与 MindMeter。本指南约束代码、文档与协作方式，目的是让改动**可追溯、可评审、可回滚**。

## 1. 开始之前

1. 阅读 [README](README.md)、[文档索引](docs/README.md) 与相关需求文档。
2. 在 GitHub Issues 中找到或创建任务，确认优先级、验收标准与负责人。
3. 涉及产品范围、计分口径、隐私合规的改动，先发起讨论，不要直接改代码或定稿文档。

## 2. 分支策略

采用简化 GitHub Flow：

| 分支 | 用途 | 约定 |
| --- | --- | --- |
| `main` | 可发布主线 | 受保护，禁止直接 push，必须通过 PR 合并 |
| `feat/<issue>-<slug>` | 新功能 | 例：`feat/12-assessment-resume` |
| `fix/<issue>-<slug>` | 缺陷修复 | 例：`fix/34-score-rounding` |
| `docs/<slug>` | 文档 | 例：`docs/risk-register-v1` |
| `chore/<slug>` | 构建、依赖、配置 | 例：`chore/ci-markdownlint` |

- 分支尽量短生命周期，合并后删除。
- 合并方式：Squash merge；PR 标题即最终提交信息。
- 发布打 `v<major>.<minor>.<patch>` 标签，并更新 [CHANGELOG](CHANGELOG.md)。

## 3. 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

允许的 `type`：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`perf`、`ci`、`build`。

示例：

```text
docs(requirements): add FR-204 resume acceptance criteria
feat(core-engine): support versioned norm tables
fix(frontend): prevent double submit on assessment finish
```

## 4. Pull Request

- PR 必须关联 Issue（`Closes #12`）。
- 一个 PR 只做一件事；文档改动与代码改动尽量分开。
- 必须填写 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 中的自查项。
- 至少 1 名评审人；涉及计分、隐私、安全、法务的改动需对应领域负责人评审。
- CI 未通过不得合并；评审意见未解决不得合并。
- 评审响应时限：工作日 1 个工作日内给出首轮意见（见沟通计划）。

## 5. 文档规范

所有文档遵循 [docs/README.md](docs/README.md)：

- 使用 Markdown；文件名为小写 `snake_case`。
- 文首必须有文档信息表（编号、版本、状态、负责人、评审人、更新日期、关联文档）。
- 需求使用稳定编号：`FR-xxx`、`NFR-xxx`、`BR-xxx`、`R-xx`、`D-xx`；编号不复用。
- **未决事项必须显式标记**：`【待定】`，并尽量在「待决策事项」表中给出负责人与截止日期。
- 变更必须更新版本号与修订记录；已批准文档的重大变更需重新评审。
- 相对链接必须可点击；新增/移动文档后同步更新 [README](README.md) 与 [docs/README.md](docs/README.md)。

## 6. 代码规范（进入开发阶段后生效）

- 提交前本地通过格式化、静态检查与单元测试；具体命令由各模块 README 维护。
- 新增逻辑必须有测试；核心计分逻辑要求覆盖正常、边界、异常与版本兼容场景。
- 禁止提交密钥、真实用户数据、未脱敏日志；测试数据必须合成或脱敏。
- 依赖新增需说明用途、许可证与替代方案；安全扫描不得有未豁免的高危漏洞。

## 7. Definition of Done

一项任务完成需同时满足：

- [ ] 验收标准全部通过，并有测试或演示证据
- [ ] 文档/注释已更新，无失效链接
- [ ] 无新增高危安全问题，隐私影响已评估
- [ ] 代码已评审并合并到 `main`
- [ ] CHANGELOG（如面向用户）已更新
- [ ] 相关待决策项已关闭或登记

## 8. 行为准则

- 对事不对人，评审聚焦事实、风险与可验证的证据。
- 尊重心理测评的专业边界：不夸大结论，不替代临床诊断。
- 用户数据与测评结果属于敏感信息，不在公开渠道讨论可识别个案。

## 9. 问题反馈

- 缺陷：使用 Issue 模板，附复现步骤、环境、期望/实际结果。
- 安全或隐私问题：**不要公开提 Issue**，私下联系【待定：安全负责人】。
- 文档问题：可直接提 PR，或在 Issue 中标注 `docs`。
