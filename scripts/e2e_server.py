"""Start the hosted web app for Playwright E2E.

Windows: boots the vendored PostgreSQL (trust auth, loopback only) into
``runtime/e2e``, applies Alembic migrations and starts uvicorn.
CI/Linux: set ``MM_E2E_DATABASE_URL`` to a pgvector-enabled database.

There is no per-launch token any more: the browser under test authenticates
with the same session cookie a real visitor gets (see tests/e2e/app.spec.js).
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
PG_BIN = ROOT / "vendor" / "pgsql" / "bin"
PGDATA = ROOT / "runtime" / "e2e" / "pgdata"
PG_USER = "mm_e2e"
PG_DATABASE = "mindmeter_e2e"
PG_PORT = int(os.environ.get("MM_E2E_PG_PORT", "55451"))
PORT = int(os.environ.get("MM_E2E_PORT", "8100"))

children: list[subprocess.Popen] = []


def stop(*_args) -> None:
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
    sys.exit(0)


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        raise RuntimeError(
            f"{command[0]} failed\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}"
        )
    return result


def pg_url(database: str = PG_DATABASE, port: int = PG_PORT) -> str:
    return f"postgresql+psycopg://{PG_USER}@127.0.0.1:{port}/{database}"


def init_cluster() -> None:
    if (PGDATA / "PG_VERSION").exists():
        return
    PGDATA.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            str(PG_BIN / "initdb"),
            "-D",
            str(PGDATA),
            "-U",
            PG_USER,
            "--auth=trust",
            "--auth-host=trust",
            "--auth-local=trust",
            "--encoding=UTF8",
            "--locale=C",
        ]
    )


def start_postgres() -> subprocess.Popen:
    log_path = ROOT / "runtime" / "e2e" / "postgres.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handle = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        [
            str(PG_BIN / "postgres"),
            "-D",
            str(PGDATA),
            "-p",
            str(PG_PORT),
            "-c",
            "listen_addresses=127.0.0.1",
            "-c",
            "max_connections=20",
            "-c",
            "logging_collector=off",
            "-c",
            "fsync=off",
            "-c",
            "synchronous_commit=off",
        ],
        stdout=handle,
        stderr=subprocess.STDOUT,
    )
    for _ in range(120):
        ready = subprocess.run(
            [str(PG_BIN / "pg_isready"), "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", PG_USER],
            capture_output=True,
        )
        if ready.returncode == 0:
            return process
        if process.poll() is not None:
            raise RuntimeError(f"PostgreSQL exited early; see {log_path}")
        time.sleep(0.5)
    raise RuntimeError(f"PostgreSQL not ready in 60s; see {log_path}")


def ensure_database() -> None:
    listed = subprocess.run(
        [str(PG_BIN / "psql"), "-w", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", PG_USER,
         "-d", "postgres", "-Atc", f"SELECT 1 FROM pg_database WHERE datname='{PG_DATABASE}'"],
        capture_output=True,
        text=True,
    )
    if listed.stdout.strip() == "1":
        return
    run([str(PG_BIN / "createdb"), "-w", "-h", "127.0.0.1", "-p", str(PG_PORT), "-U", PG_USER, PG_DATABASE])


def migrate(url: str) -> None:
    env = dict(os.environ)
    env["MM_MIGRATION_DATABASE_URL"] = url
    env["MM_DATABASE_URL"] = url
    run(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"), "upgrade", "head"],
        cwd=str(BACKEND),
        env=env,
    )


def serve(url: str) -> subprocess.Popen:
    env = dict(os.environ)
    env.update(
        {
            "MM_DATABASE_URL": url,
            "MM_AUTO_MIGRATE": "0",
            "MM_RAG_MODE": "keyword",
            "MM_DATA_DIR": str(ROOT / "runtime" / "e2e"),
            "MM_COOKIE_SECURE": "false",
            "PYTHON_KEYRING_BACKEND": "",
        }
    )
    env.pop("PYTHON_KEYRING_BACKEND", None)
    process = subprocess.Popen(
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
    print(f"E2E app on http://127.0.0.1:{PORT} (db: {url})", flush=True)
    return process


def main() -> int:
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    external = os.environ.get("MM_E2E_DATABASE_URL")
    if external:
        migrate(external)
        children.append(serve(external))
        children[-1].wait()
        return 0

    if os.name != "nt":
        raise SystemExit(
            "MM_E2E_DATABASE_URL is required on non-Windows. "
            "CI must provide a pgvector/pgvector:pg17 service."
        )
    if not (PG_BIN / "postgres").exists() and not (PG_BIN / "postgres.exe").exists():
        raise SystemExit("缺少便携版 PostgreSQL：请先运行 scripts/fetch_pgsql.ps1")

    init_cluster()
    children.append(start_postgres())
    ensure_database()
    url = pg_url()
    migrate(url)
    children.append(serve(url))
    while children[-1].poll() is None:
        time.sleep(1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
