"""Start a local API for Playwright E2E.

Windows: uses the vendored portable PostgreSQL + Alembic + uvicorn.
CI/Linux: set MM_E2E_DATABASE_URL to a pgvector-enabled database; migrations
are applied with alembic, then uvicorn starts.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "code" / "backend"
TOKEN = os.environ.get("MM_E2E_TOKEN", "e2e-token")
PORT = int(os.environ.get("MM_E2E_PORT", "8000"))
os.environ.setdefault("MM_API_TOKEN", TOKEN)

children: list[subprocess.Popen] = []


def stop(*_args) -> None:
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
    sys.exit(0)


def ensure_extension(url: str) -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))


def run_migrations(url: str) -> None:
    ensure_extension(url)
    env = dict(os.environ)
    env["MM_MIGRATION_DATABASE_URL"] = url
    env["MM_DATABASE_URL"] = url
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"), "upgrade", "head"],
        cwd=str(BACKEND),
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)


def main() -> int:
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    external = os.environ.get("MM_E2E_DATABASE_URL")
    if external:
        run_migrations(external)
        env = dict(os.environ)
        env["MM_DATABASE_URL"] = external
        env["MM_API_TOKEN"] = TOKEN
        env["MM_DATA_DIR"] = str(ROOT / "runtime" / "e2e-data")
        backend = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(PORT),
                "--no-access-log",
            ],
            cwd=str(BACKEND),
            env=env,
        )
        children.append(backend)
        backend.wait()
        return 0

    # Portable Windows path: reuse the launcher's DB helpers.
    os.environ.setdefault("MM_DATA_DIR", str(ROOT / "runtime" / "e2e-data"))
    os.environ["MM_API_TOKEN"] = TOKEN
    sys.path.insert(0, str(ROOT / "code"))
    from desktop import launcher

    launcher.check_vendor()
    launcher.initdb()
    pg_port = int(os.environ.get("MM_E2E_PG_PORT", "55433"))
    postgres = launcher.start_postgres(pg_port)
    children.append(postgres)
    launcher.ensure_database(pg_port)
    launcher.backup_before_migration(pg_port)
    launcher.run_migrations(pg_port)
    backend = launcher.start_backend(PORT, TOKEN, pg_port)
    children.append(backend)
    while backend.poll() is None:
        time.sleep(1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
