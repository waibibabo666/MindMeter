#!/usr/bin/env python3
"""Report frontend modules that are unreachable from src/app.js.

Static ES imports only (`import ... from './x.js'`, `import('./x.js')`), resolved
relative to the importer. Runtime-dead files are a failure EXCEPT for the
allow-list below: authored data/assets that live under `src/` but are consumed
by tooling and tests instead of the browser. Run:

    python scripts/check_frontend_dead_code.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "code" / "frontend" / "src"
ENTRIES = [SRC / "app.js", SRC / "boot.js"]
IMPORT_RE = re.compile(r"""(?:from|import)\s*\(?\s*['"]([^'"]+)['"]""")

# 不是浏览器代码，但是**受测试的内容资产**：
# - kb/chunks.js 是 30 条知识块的唯一人工来源，经 scripts/export_kb_seed.mjs
#   导出成后端迁移用的 app/rag/kb_seed.json；
# - kb/chunk.schema.json 与 scripts/test_kb.js 一起校验上面的结构；
# - kb/queries.json + kb/search.js 是 BM25 的参照实现，后端 app/rag 逐字对齐它。
ALLOWED_DEAD = {
    "kb/chunks.js",
    "kb/chunk.schema.json",
    "kb/queries.json",
    "kb/search.js",
}


def resolve(importer: Path, spec: str) -> Path | None:
    if not spec.startswith("."):
        return None
    target = (importer.parent / spec).resolve()
    if target.is_file():
        return target
    for suffix in (".js", ".json"):
        if Path(str(target) + suffix).is_file():
            return Path(str(target) + suffix)
    if (target / "index.js").is_file():
        return target / "index.js"
    return None


def main() -> int:
    live: set[Path] = set()
    queue = [entry.resolve() for entry in ENTRIES if entry.exists()]
    missing: list[str] = []
    while queue:
        path = queue.pop()
        if path in live or not path.is_file():
            continue
        live.add(path)
        if path.suffix != ".js":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for spec in IMPORT_RE.findall(text):
            resolved = resolve(path, spec)
            if resolved is None:
                if spec.startswith("."):
                    missing.append(f"{path.relative_to(SRC)}: unresolved {spec}")
                continue
            queue.append(resolved)

    all_files = sorted(p for p in SRC.rglob("*") if p.is_file() and p.suffix in {".js", ".json"})
    dead = [p for p in all_files if p.resolve() not in live]
    unexpected = [p for p in dead if str(p.relative_to(SRC)).replace("\\", "/") not in ALLOWED_DEAD]
    stale = {str(p.relative_to(SRC)).replace("\\", "/") for p in dead}
    obsolete_allowed = sorted(name for name in ALLOWED_DEAD if name not in stale)

    print(f"reachable: {len(live)}  files under src: {len(all_files)}")
    for path in dead:
        rel = str(path.relative_to(SRC)).replace("\\", "/")
        print(f"{'ASSET' if rel in ALLOWED_DEAD else 'DEAD '} {rel}")
    for line in missing:
        print(f"BROKEN {line}")
    if unexpected:
        print(f"\nFAILED: {len(unexpected)} 个不可达模块（浏览器 legacy 不要留着）")
        return 1
    if obsolete_allowed:
        print(f"\nNOTE: allow-list 里有 {len(obsolete_allowed)} 项已不存在，可清理：{', '.join(obsolete_allowed)}")
    if missing:
        return 1
    print("OK: 只有受测试的内容资产不在浏览器可达路径上")
    return 0


if __name__ == "__main__":
    sys.exit(main())
