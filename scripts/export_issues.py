#!/usr/bin/env python3
"""Generate a GitHub Issues import CSV from docs/mgmt/task_breakdown.md.

Usage:
    python scripts/export_issues.py            # write docs/mgmt/issues.csv
    python scripts/export_issues.py --check    # fail if the CSV is stale
"""
from __future__ import annotations

import csv
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "mgmt" / "task_breakdown.md"
OUTPUT = ROOT / "docs" / "mgmt" / "issues.csv"

ROW_RE = re.compile(r"^\|\s*((?:P|BE|AS|RG|AG|FE|QA|OPS)-\d+)\s*\|")

AREA = {
    "P": ("M0", "area:planning"),
    "BE": ("M1", "area:backend"),
    "AS": ("M1", "area:scoring"),
    "RG": ("M1", "area:rag"),
    "AG": ("M1", "area:agent"),
    "FE": ("M1", "area:frontend"),
    "QA": ("M1", "area:qa"),
    "OPS": ("M1", "area:ops"),
}

AI_DRAFT = {
    "P": "API/DB/线框/契约初稿",
    "BE": "路由/CRUD/Pydantic/测试骨架",
    "AS": "公式/配置/单测骨架",
    "RG": "ingest/检索代码/重建脚本",
    "AG": "LangGraph 节点/prompt/测试骨架",
    "FE": "页面/交互/样式初稿",
    "QA": "测试脚本/用例骨架/CI 配置",
    "OPS": "Docker/部署/备份脚本",
}

HUMAN = {
    "P": "接口/DB/范围取舍，契约评审，确认无越权/无 Key 字段",
    "BE": "authz/事务/迁移/限流/错误语义；手工 API 与越权验证",
    "AS": "公式语义、手算金标准、缺失规则、无总分/常模确认",
    "RG": "语料审核/版权/版本、hit@3 与引用正确性",
    "AG": "意图边界、禁用词、数字校验、red-team、删除记忆不引用",
    "FE": "UX/文案/360px/键盘/空错降级状态/手工走查",
    "QA": "真实跑测试、判断通过、截图/视频证据、flaky 判断",
    "OPS": "生产密钥/域名/DB/备份恢复/回滚/发布批准",
}

# Human names in the task table -> GitHub logins.
ASSIGNEE_MAP = {
    "song": "SONG-bot418",
}


def parse_tasks() -> list[dict]:
    text = SOURCE.read_text(encoding="utf-8")
    tasks: list[dict] = []
    for line in text.splitlines():
        match = ROW_RE.match(line.strip())
        if not match:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 7:
            raise SystemExit(f"unexpected table row ({len(cells)} cells): {line}")
        task_id, title, owner, support, estimate, deps, acceptance = cells
        prefix = task_id.split("-", 1)[0]
        milestone, area = AREA[prefix]
        body = f"""## 背景

来源：`docs/mgmt/task_breakdown.md`（{task_id}）。

## 验收

{acceptance}

## 依赖

{deps}

## 负责人 / 支持

- Owner: {owner}
- Support: {support}
- Estimate: {estimate} 人日

## AI 协作

- AI 可初稿：{AI_DRAFT[prefix]}
- 人必须做：{HUMAN[prefix]}
- 验收命令：
- 手工验证：
- 证据（命令/截图/评测）：

## DoR

- [ ] 关联需求/API/数据模型
- [ ] 验收条件可判定
- [ ] 测试点已写
- [ ] 依赖已清或标注

## DoD

- [ ] 代码 + 单测/集成测试
- [ ] CI 绿（docs/prototype/backend/security）
- [ ] 至少 1 人 review；auth/Key/计分 2 人
- [ ] API/README/变更记录已同步
- [ ] 无真实用户数据、无 Key/PII 入库
"""
        tasks.append({
            "ID": task_id,
            "Title": f"[{task_id}] {title}",
            "Body": body.strip(),
            "Labels": f"{milestone},{area}",
            "Milestone": milestone,
            "Assignees": ASSIGNEE_MAP.get(owner, owner),
            "Owner": owner,
            "Support": support,
            "Estimate": estimate,
            "Dependencies": deps,
            "Acceptance": acceptance,
        })
    if not tasks:
        raise SystemExit(f"no tasks found in {SOURCE}")
    return tasks


def render_csv(tasks: list[dict]) -> str:
    buffer = io.StringIO()
    fields = ["ID", "Title", "Body", "Labels", "Milestone", "Assignees", "Owner", "Support", "Estimate", "Dependencies", "Acceptance"]
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(tasks)
    return buffer.getvalue()


def main() -> int:
    check = "--check" in sys.argv[1:]
    tasks = parse_tasks()
    content = render_csv(tasks)

    if check:
        if not OUTPUT.exists():
            print(f"missing {OUTPUT.relative_to(ROOT)}; run: python scripts/export_issues.py")
            return 1
        if OUTPUT.read_text(encoding="utf-8") != content:
            print(f"stale {OUTPUT.relative_to(ROOT)}; run: python scripts/export_issues.py")
            return 1
        print(f"OK: {len(tasks)} tasks, issues.csv is up to date")
        return 0

    OUTPUT.write_text(content, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {len(tasks)} tasks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
