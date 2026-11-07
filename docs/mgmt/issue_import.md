# GitHub Issues 导入说明

## 1. 生成/更新 CSV

任务表是唯一来源：[task_breakdown.md](task_breakdown.md)。

```bash
python scripts/export_issues.py          # 写 docs/mgmt/issues.csv
python scripts/export_issues.py --check  # CI 校验是否过期
```

CSV 包含 50 条任务，字段：

`ID, Title, Body, Labels, Milestone, Assignees, Owner, Support, Estimate, Dependencies, Acceptance`

每条 Issue 正文都带 **AI 协作** 区块（AI 可初稿 / 人必须做 / 验收命令 / 手工验证 / 证据），对应 [AI 协作任务设计](ai_collaboration.md)。

> 任务表里的 `song` 在 CSV 中映射为 GitHub login `SONG-bot418`；`waibibabo666`、`xlr268`、`1213lz` 原样使用。

## 2. 先建标签与里程碑

创建 Issue 前，仓库里需要有这些标签/里程碑（示例命令，按需改颜色）：

```bash
gh label create "M0" --color "5319e7"
gh label create "M1" --color "0e8a16"
gh label create "area:planning" --color "c5def5"
gh label create "area:backend" --color "1d76db"
gh label create "area:scoring" --color "fbca04"
gh label create "area:rag" --color "d93f0b"
gh label create "area:agent" --color "8b5cf6"
gh label create "area:frontend" --color "f9d0c4"
gh label create "area:qa" --color "bfd4f2"
gh label create "area:ops" --color "006b75"
```

里程碑：

```bash
gh api repos/{owner}/{repo}/milestones -f title="M0" -f description="契约与设计"
gh api repos/{owner}/{repo}/milestones -f title="M1" -f description="账号 + 标准 4 项 + Agent"
```

## 3. 预览与创建

```bash
# 默认 dry-run，只打印
python scripts/create_issues.py --dry-run --limit 10

# 先建 1 条试水
python scripts/create_issues.py --apply --limit 1

# 全量
python scripts/create_issues.py --apply
```

`gh` 必须已登录，且对目标仓库有 issue 写权限。脚本不创建标签/里程碑，缺了会报错；按第 2 步先建。

## 4. 建议的建单批次

| 批次 | 任务 |
| --- | --- |
| 批次 1 | P-01～P-09（M0 契约） |
| 批次 2 | BE-01/02、AS-01/02、RG-01、QA-01（走后端） |
| 批次 3 | BE-03～BE-10、AG-01～AG-07、FE-01～FE-09 |
| 批次 4 | QA-02～QA-05、OPS-01～OPS-03 |

## 5. 约定

- Issue 标题：`[ID] 任务名`；
- Issue 模板：`.github/ISSUE_TEMPLATE/task.md`；
- 不要直接把 50 条全部建完再开工：先建 M0 + 第一批 M1，保持看板可读；
- CSV 改动后跑 `python scripts/export_issues.py`，否则 CI 会因 `--check` 失败。
