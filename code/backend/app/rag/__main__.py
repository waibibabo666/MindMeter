"""CLI: python -m app.rag ingest [--force]"""
from __future__ import annotations

import argparse

from ..db import SessionLocal
from . import ingest_embeddings, rag_status


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["ingest", "status"], nargs="?", default="ingest")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.command == "status":
            print(rag_status(db))
            return 0
        count = ingest_embeddings(db, force=args.force)
        print(f"embedded {count} chunks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
