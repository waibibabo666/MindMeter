#!/usr/bin/env python
"""生成 3.7 代码统计图（真实 git 跟踪文件：模块数 / 行数）。

输出：docs/slides/images/code-stats.svg / .png
用法：python docs/slides/tools/make-code-stats.py
"""
from __future__ import annotations

import html
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT_DIR = ROOT / "docs" / "slides" / "images"
SNAPSHOT = "2026-11-28"


def run(cmd: list[str]) -> str:
    return subprocess.run(
        cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace"
    ).stdout


def lines_of(rel: str) -> int:
    try:
        data = (ROOT / rel).read_bytes()
    except OSError:
        return 0
    if b"\x00" in data[:2000]:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


files = [f.replace("\\", "/") for f in run(["git", "ls-files"]).splitlines()]
TESTS_PREFIX = ("tests/", "code/frontend/tests/", "code/backend/tests/")

categories = [
    {"key": "backend", "label": "后端（Python）", "color": "#15803d"},
    {"key": "frontend", "label": "前端（JS/CSS/HTML）", "color": "#22c55e"},
    {"key": "tests", "label": "测试（Python + JS）", "color": "#4f46e5"},
    {"key": "scripts", "label": "脚本（质量/部署/数据）", "color": "#b45309"},
]
stats = {c["key"]: {"files": 0, "lines": 0} for c in categories}

for rel in files:
    ext = pathlib.Path(rel).suffix.lower()
    if any(rel.startswith(prefix) for prefix in TESTS_PREFIX):
        key = "tests"
    elif rel.startswith("code/backend/") and ext == ".py":
        key = "backend"
    elif rel.startswith("code/frontend/") and ext in {".js", ".css", ".html"}:
        key = "frontend"
    elif rel.startswith("scripts/"):
        key = "scripts"
    else:
        continue
    stats[key]["files"] += 1
    stats[key]["lines"] += lines_of(rel)

total_files = sum(s["files"] for s in stats.values())
total_lines = sum(s["lines"] for s in stats.values())

# ---------- SVG ----------
W, H = 1600, 700
PAD = 72
max_lines = max(s["lines"] for s in stats.values())
bar_x = 430
bar_w = 780
row_start = 316
row_h = 84

parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
    "font-family=\"'Microsoft YaHei','Segoe UI',Arial,sans-serif\">",
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>',
    f'<text x="{PAD}" y="84" font-size="38" font-weight="700" fill="#1f2328">3.7 代码统计</text>',
    f'<text x="{PAD}" y="122" font-size="17" fill="#6b7280">git 跟踪文件 · 快照 {SNAPSHOT} · 不含文档 / 依赖 / 生成物</text>',
]

kpis = [
    ("文件总数", f"{total_files}"),
    ("代码行数", f"{total_lines:,}"),
    ("测试行占比", f"{stats['tests']['lines'] / total_lines * 100:.1f}%"),
]
chip_w = 460
chip_gap = 32
for index, (label, value) in enumerate(kpis):
    x = PAD + index * (chip_w + chip_gap)
    parts.append(f'<rect x="{x}" y="158" width="{chip_w}" height="76" rx="14" fill="#f8faf9" stroke="#e2e8e5"/>')
    parts.append(f'<text x="{x + 24}" y="190" font-size="15" fill="#6b7280">{label}</text>')
    parts.append(f'<text x="{x + 24}" y="220" font-size="27" font-weight="700" fill="#1f2328">{value}</text>')

for index, category in enumerate(categories):
    data = stats[category["key"]]
    y = row_start + index * row_h
    width = max(6.0, data["lines"] / max_lines * bar_w) if max_lines else 0
    share = data["lines"] / total_lines * 100 if total_lines else 0
    parts.append(f'<text x="{PAD}" y="{y + 26}" font-size="21" font-weight="700" fill="#1f2328">{category["label"]}</text>')
    parts.append(f'<text x="{PAD}" y="{y + 52}" font-size="14.5" fill="#9aa1aa">{data["files"]} 个文件</text>')
    parts.append(f'<rect x="{bar_x}" y="{y + 8}" width="{bar_w}" height="26" rx="7" fill="#f1f5f3"/>')
    parts.append(
        f'<rect x="{bar_x}" y="{y + 8}" width="{width:.1f}" height="26" rx="7" fill="{category["color"]}"/>'
    )
    parts.append(
        f'<text x="{W - PAD}" y="{y + 30}" font-size="18" font-weight="650" fill="#334155" text-anchor="end">{data["lines"]:,} 行 · {share:.1f}%</text>'
    )

parts.append("</svg>")
svg = "\n".join(parts)
OUT_DIR.mkdir(parents=True, exist_ok=True)
svg_path = OUT_DIR / "code-stats.svg"
svg_path.write_text(svg, "utf-8")
print(f"SVG 已生成：{svg_path.relative_to(ROOT)}")
print(f"文件 {total_files} · 行 {total_lines} · 测试占比 {stats['tests']['lines'] / total_lines * 100:.1f}%")
for category in categories:
    data = stats[category["key"]]
    print(f"  {category['label']}: {data['files']} 文件 / {data['lines']} 行")

# ---------- PNG（用系统 Edge 离屏截图，避免依赖 Playwright 浏览器版本） ----------
edge_candidates = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
edge = next((path for path in edge_candidates if pathlib.Path(path).exists()), None)
if edge:
    png_path = OUT_DIR / "code-stats.png"
    url = "file:///" + svg_path.as_posix()
    subprocess.run(
        [
            edge,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--force-device-scale-factor=2",
            f"--window-size={W},{H}",
            f"--screenshot={png_path}",
            url,
        ],
        capture_output=True,
    )
    if png_path.exists():
        print(f"PNG 已生成：{png_path.relative_to(ROOT)}")
else:
    print("未找到 Edge，跳过 PNG（SVG 可用）")
