"""MindMeter desktop launcher.

Owns the whole local runtime:
  pywebview window -> FastAPI subprocess -> portable PostgreSQL subprocess

The launcher, not FastAPI, performs initdb, CREATE EXTENSION, pg_dump, and
alembic upgrade. Closing the window stops the backend first and PostgreSQL
second.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote_plus

APP_NAME = "MindMeter"
WINDOW_TITLE = "MindMeter · 心智镜"
IS_WINDOWS = os.name == "nt"
CREATE_NO_WINDOW = 0x08000000 if IS_WINDOWS else 0


def run_hidden(command, *, timeout=None, env=None, cwd=None):
    """跑控制台程序时不弹黑框。

    启动器自身是 pythonw（无控制台），initdb / alembic / pg_isready 这类
    控制台子进程如果不带 CREATE_NO_WINDOW，各自会弹出一个黑色窗口。
    """
    kwargs = {"capture_output": True, "text": True}
    if timeout is not None:
        kwargs["timeout"] = timeout
    if env is not None:
        kwargs["env"] = env
    if cwd is not None:
        kwargs["cwd"] = cwd
    if IS_WINDOWS:
        kwargs["creationflags"] = CREATE_NO_WINDOW
    return subprocess.run(command, **kwargs)


def app_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


ROOT = app_root()
BACKEND_DIR = ROOT / "code" / "backend"
FRONTEND_DIR = ROOT / "code" / "frontend"
VENDOR = ROOT / "vendor" / "pgsql"
PG_BIN = VENDOR / "bin"
DATA_DIR = Path(os.environ.get("MM_DATA_DIR") or Path(os.environ.get("LOCALAPPDATA", Path.home())) / APP_NAME)
PGDATA = DATA_DIR / "pgdata"
RUNTIME = DATA_DIR / "runtime"
LOGS = DATA_DIR / "logs"
BACKUPS = DATA_DIR / "backups"


def log(message: str) -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
    print(line, flush=True)
    with (LOGS / "launcher.log").open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def use_data_dir(path: Path) -> None:
    """Switch all data paths (used when LocalAppData ACLs block initdb)."""
    global DATA_DIR, PGDATA, RUNTIME, LOGS, BACKUPS
    DATA_DIR = Path(path)
    PGDATA = DATA_DIR / "pgdata"
    RUNTIME = DATA_DIR / "runtime"
    LOGS = DATA_DIR / "logs"
    BACKUPS = DATA_DIR / "backups"
    for directory in (DATA_DIR, RUNTIME, LOGS, BACKUPS):
        directory.mkdir(parents=True, exist_ok=True)


def initdb_with_fallback() -> None:
    """Try LocalAppData first; fall back if a sandbox/ACL blocks initdb."""
    explicit = os.environ.get("MM_DATA_DIR")
    candidates = [DATA_DIR]
    if not explicit:
        candidates.extend([ROOT / "runtime" / "data", Path(os.environ.get("TEMP", ".")) / "MindMeter"])
    last_error = None
    for index, candidate in enumerate(candidates):
        use_data_dir(candidate)
        try:
            initdb()
            if index > 0:
                log(f"using fallback data dir: {DATA_DIR}")
            return
        except RuntimeError as exc:
            last_error = exc
            text = str(exc)
            if "Permission denied" not in text and "权限" not in text:
                raise
            log(f"initdb blocked in {candidate}: {text.splitlines()[-1] if text else exc}")
            if (PGDATA / "PG_VERSION").exists():
                raise
            failed = PGDATA.with_name(f"pgdata.failed-{int(time.time())}")
            if PGDATA.exists():
                try:
                    PGDATA.rename(failed)
                except OSError:
                    pass
    raise last_error or RuntimeError("initdb failed")


def message_box(text: str, title: str = APP_NAME) -> None:
    if IS_WINDOWS:
        ctypes.windll.user32.MessageBoxW(None, text, title, 0x10)


if IS_WINDOWS:
    from ctypes import wintypes

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]


def create_kill_on_close_job():
    if not IS_WINDOWS:
        return None
    kernel32 = ctypes.windll.kernel32
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return None
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    kernel32.SetInformationJobObject(
        job, 9, ctypes.byref(info), ctypes.sizeof(info)
    )
    return job


def assign_to_job(job, process: subprocess.Popen | None) -> None:
    if not IS_WINDOWS or job is None or process is None:
        return
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x1F0FFF, False, process.pid)
    if handle:
        kernel32.AssignProcessToJobObject(job, handle)
        kernel32.CloseHandle(handle)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def single_instance() -> tuple[object | None, bool]:
    if not IS_WINDOWS:
        return None, True
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, "Local\\MindMeter.Desktop")
    if not handle:
        return None, True
    already = kernel32.GetLastError() == 183
    return handle, not already


def keyring_secret(username: str) -> str:
    import keyring

    value = keyring.get_password(APP_NAME, username)
    if value:
        return value
    value = secrets.token_urlsafe(32)
    keyring.set_password(APP_NAME, username, value)
    return value


def pg_url(user: str, password: str, port: int, database: str) -> str:
    return (
        f"postgresql+psycopg://{quote_plus(user)}:{quote_plus(password)}"
        f"@127.0.0.1:{port}/{database}"
    )


def check_vendor() -> None:
    required = ["initdb.exe", "postgres.exe", "pg_ctl.exe", "pg_isready.exe", "pg_dump.exe", "psql.exe"]
    missing = [name for name in required if not (PG_BIN / name).exists()]
    if missing:
        raise RuntimeError(
            "缺少便携版 PostgreSQL："
            + ", ".join(missing)
            + f"\n请将 PostgreSQL 17.12 Windows x64 解压到：\n{VENDOR}"
        )
    if not (PG_BIN.parent / "share" / "extension" / "vector.control").exists():
        raise RuntimeError(
            "缺少 pgvector 扩展文件：\n"
            f"{PG_BIN.parent / 'share' / 'extension' / 'vector.control'}\n"
            "请把 vector.control / vector--*.sql 放到 share/extension，"
            "vector.dll 放到 lib/。"
        )


def write_config(port: int) -> None:
    # postgresql.auto.conf is read after postgresql.conf and is rewritten on
    # each launch, so ports/options never accumulate duplicate lines.
    conf = PGDATA / "postgresql.auto.conf"
    conf.write_text(
        f"""
# MindMeter local overrides (rewritten each launch)
listen_addresses = '127.0.0.1'
port = {port}
max_connections = 20
shared_buffers = '128MB'
password_encryption = 'scram-sha-256'
log_statement = 'none'
log_min_duration_statement = -1
logging_collector = off
timezone = 'UTC'
""".lstrip(),
        encoding="utf-8",
    )

    hba = PGDATA / "pg_hba.conf"
    hba.write_text(
        "# MindMeter: loopback only, scram-sha-256, no trust\n"
        "host all all 127.0.0.1/32 scram-sha-256\n"
        "host all all ::1/128 reject\n",
        encoding="utf-8",
    )


def initdb() -> None:
    import keyring

    if (PGDATA / "PG_VERSION").exists():
        return
    PGDATA.mkdir(parents=True, exist_ok=True)
    password = keyring_secret("pg-admin")
    pwfile = RUNTIME / "pg-admin.pw"
    RUNTIME.mkdir(parents=True, exist_ok=True)
    pwfile.write_text(password, encoding="utf-8")
    try:
        command = [
            str(PG_BIN / "initdb.exe"),
            "-D",
            str(PGDATA),
            "-U",
            "mm_admin",
            "--pwfile",
            str(pwfile),
            "--auth-host=scram-sha-256",
            "--encoding=UTF8",
            "--locale=C",
            "--data-checksums",
        ]
        log("initdb: " + " ".join(command))
        result = run_hidden(command, timeout=180)
        if result.returncode != 0:
            raise RuntimeError("initdb 失败：\n" + (result.stderr or result.stdout)[-2000:])
    finally:
        pwfile.unlink(missing_ok=True)


def start_postgres(port: int) -> subprocess.Popen:
    write_config(port)
    log_path = LOGS / "postgres.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handle = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        [
            str(PG_BIN / "postgres.exe"),
            "-D",
            str(PGDATA),
            "-p",
            str(port),
            "-c",
            "listen_addresses=127.0.0.1",
            "-c",
            "logging_collector=off",
        ],
        stdout=handle,
        stderr=subprocess.STDOUT,
        creationflags=CREATE_NO_WINDOW,
    )
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError("PostgreSQL 启动失败，查看日志：" + str(log_path))
        probe = run_hidden(
            [
                str(PG_BIN / "pg_isready.exe"),
                "-h",
                "127.0.0.1",
                "-p",
                str(port),
                "-U",
                "mm_admin",
                "-d",
                "postgres",
            ],
            timeout=5,
        )
        if probe.returncode == 0:
            return process
        time.sleep(0.5)
    raise RuntimeError("PostgreSQL 未在 60 秒内就绪，查看日志：" + str(log_path))


def ensure_database(port: int) -> None:
    import psycopg
    from psycopg import sql

    admin = keyring_secret("pg-admin")
    app_password = keyring_secret("pg-app")
    with psycopg.connect(
        host="127.0.0.1",
        port=port,
        user="mm_admin",
        password=admin,
        dbname="postgres",
        autocommit=True,
    ) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = 'mindmeter'").fetchone()
        if not exists:
            conn.execute("CREATE DATABASE mindmeter")
        role_exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'mm_app'").fetchone()
        if not role_exists:
            conn.execute(
                sql.SQL("CREATE ROLE mm_app LOGIN PASSWORD {}").format(sql.Literal(app_password))
            )
        else:
            conn.execute(
                sql.SQL("ALTER ROLE mm_app WITH LOGIN PASSWORD {}").format(sql.Literal(app_password))
            )

    with psycopg.connect(
        host="127.0.0.1",
        port=port,
        user="mm_admin",
        password=admin,
        dbname="mindmeter",
        autocommit=True,
    ) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.execute("GRANT USAGE ON SCHEMA public TO mm_app")
        conn.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mm_app")
        conn.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mm_app")
        conn.execute("GRANT USAGE ON TYPE vector TO mm_app")
        conn.execute(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mm_app"
        )
        conn.execute(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            "GRANT USAGE, SELECT ON SEQUENCES TO mm_app"
        )


def backup_before_migration(port: int) -> Path | None:
    import psycopg

    admin = keyring_secret("pg-admin")
    with psycopg.connect(
        host="127.0.0.1", port=port, user="mm_admin", password=admin, dbname="mindmeter"
    ) as conn:
        has_table = conn.execute("SELECT to_regclass('public.alembic_version')").fetchone()[0]
        if not has_table:
            return None
        count = conn.execute("SELECT count(*) FROM alembic_version").fetchone()[0]
        if not count:
            return None

    BACKUPS.mkdir(parents=True, exist_ok=True)
    target = BACKUPS / f"mindmeter-{time.strftime('%Y%m%d-%H%M%S')}.dump"
    env = dict(os.environ)
    env["PGPASSWORD"] = admin
    result = run_hidden(
        [
            str(PG_BIN / "pg_dump.exe"),
            "-Fc",
            "-h",
            "127.0.0.1",
            "-p",
            str(port),
            "-U",
            "mm_admin",
            "-d",
            "mindmeter",
            "-f",
            str(target),
        ],
        env=env,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError("迁移前 pg_dump 失败：\n" + result.stderr[-1500:])
    log(f"backup: {target}")
    return target


def run_migrations(port: int) -> None:
    admin = keyring_secret("pg-admin")
    env = dict(os.environ)
    env["MM_MIGRATION_DATABASE_URL"] = pg_url("mm_admin", admin, port, "mindmeter")
    env["MM_DATABASE_URL"] = pg_url("mm_app", keyring_secret("pg-app"), port, "mindmeter")
    result = run_hidden(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND_DIR / "alembic.ini"), "upgrade", "head"],
        cwd=str(BACKEND_DIR),
        env=env,
        timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError("Alembic 迁移失败：\n" + (result.stderr or result.stdout)[-2500:])
    log("alembic upgrade head: ok")


def run_embedding_ingest(pg_port: int) -> None:
    """Best-effort pgvector ingest; keyword BM25 remains available on failure."""
    if os.environ.get("MM_SKIP_EMBEDDINGS") == "1":
        return
    env = dict(os.environ)
    env["MM_DATABASE_URL"] = pg_url("mm_app", keyring_secret("pg-app"), pg_port, "mindmeter")
    env["MM_DATA_DIR"] = str(DATA_DIR)
    env["FASTEMBED_CACHE_PATH"] = str(DATA_DIR / "models")
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    for name in ("NO_PROXY", "no_proxy"):
        value = env.get(name, "")
        if value:
            env[name] = ",".join(
                part for part in value.split(",") if part.strip() not in {"[::1]", "::1"}
            )
    try:
        result = run_hidden(
            [sys.executable, "-m", "app.rag", "ingest"],
            cwd=str(BACKEND_DIR),
            env=env,
            timeout=240,
        )
        if result.returncode == 0:
            log("embedding ingest: " + (result.stdout.strip().splitlines()[-1] if result.stdout else "ok"))
        else:
            log("embedding ingest skipped: " + (result.stderr or result.stdout)[-300:])
    except Exception as exc:  # noqa: BLE001 - optional enhancement
        log(f"embedding ingest skipped: {exc}")


def wait_health(port: int, token: str, timeout: float = 45.0) -> dict:
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/v1/health",
                headers={"X-MM-Token": token},
            )
            with urllib.request.urlopen(request, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if payload.get("status") == "ok":
                    return payload
                last_error = str(payload)
        except Exception as exc:  # noqa: BLE001 - startup probe
            last_error = str(exc)
        time.sleep(0.25)
    raise RuntimeError("本地服务未就绪：" + last_error)


def start_backend(
    port: int, token: str, pg_port: int, extra_env: dict | None = None
) -> subprocess.Popen:
    env = dict(os.environ)
    env.update(extra_env or {})
    env.update(
        {
            "MM_API_TOKEN": token,
            "MM_DATABASE_URL": pg_url("mm_app", keyring_secret("pg-app"), pg_port, "mindmeter"),
            "MM_DATA_DIR": str(DATA_DIR),
            "MM_FRONTEND_DIR": str(FRONTEND_DIR),
            "MM_PG_DUMP": str(PG_BIN / "pg_dump.exe"),
            "MM_PG_HOST": "127.0.0.1",
            "MM_PG_PORT": str(pg_port),
            "MM_PG_USER": "mm_app",
            "MM_PG_DATABASE": "mindmeter",
            "MM_PG_PASSWORD": keyring_secret("pg-app"),
            "FASTEMBED_CACHE_PATH": str(DATA_DIR / "models"),
            "HF_HUB_DISABLE_SYMLINKS_WARNING": "1",
        }
    )
    # httpx 0.28 cannot parse bracketed IPv6 entries in NO_PROXY.
    for name in ("NO_PROXY", "no_proxy"):
        value = env.get(name, "")
        if value:
            env[name] = ",".join(
                part for part in value.split(",") if part.strip() not in {"[::1]", "::1"}
            )
    log_path = LOGS / "backend.log"
    handle = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
        ],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=handle,
        stderr=subprocess.STDOUT,
        creationflags=CREATE_NO_WINDOW,
    )
    return process


def stop_process(process: subprocess.Popen | None, name: str) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        log(f"{name} 未在 8 秒内退出，强制结束")
        process.kill()


def stop_postgres(port: int) -> None:
    try:
        run_hidden(
            [
                str(PG_BIN / "pg_ctl.exe"),
                "-D",
                str(PGDATA),
                "stop",
                "-m",
                "fast",
                "-w",
                "-t",
                "30",
            ],
            timeout=40,
        )
    except Exception as exc:  # noqa: BLE001
        log(f"pg_ctl stop 失败：{exc}")


class Bridge:
    def __init__(self, token: str):
        self._token = token

    def get_boot(self) -> dict:
        return {"apiBase": "/api/v1", "token": self._token, "version": "0.2.0"}

    def quit_app(self) -> bool:
        """前端「退出」按钮：关窗口，后台接着走 finally 停掉 FastAPI 与 PostgreSQL。

        不把 Window 对象挂在 Bridge 上——pywebview 会遍历 js_api 的属性，
        挂上去可能让整个 api 桥构建失败；这里用时再取。
        """
        import threading

        threading.Thread(target=_destroy_window, daemon=True).start()
        return True


def _destroy_window() -> None:
    import webview

    try:
        windows = getattr(webview, "windows", None) or []
        if windows:
            windows[0].destroy()
    except Exception as exc:  # noqa: BLE001
        log(f"destroy window failed: {exc}")


SPLASH = """
<!doctype html><meta charset="utf-8">
<style>
body{margin:0;background:#0f172a;color:#e2e8f0;font:16px/1.6 system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh}
.card{text-align:center}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;
background:#38bdf8;margin:0 3px;animation:b 1s infinite alternate}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes b{from{opacity:.25}to{opacity:1}}
</style>
<div class="card"><h2>MindMeter 正在启动</h2>
<p>本地数据库与解读服务准备中…</p>
<p><span class="dot"></span><span class="dot"></span><span class="dot"></span></p></div>
"""


def run_window(token: str, port: int) -> None:
    import webview

    bridge = Bridge(token)
    window = webview.create_window(
        WINDOW_TITLE,
        html=SPLASH,
        width=1280,
        height=900,
        min_size=(960, 640),
        js_api=bridge,
    )

    def load_app() -> None:
        try:
            window.load_url(f"http://127.0.0.1:{port}/")
        except Exception as exc:  # noqa: BLE001
            log(f"load_url failed: {exc}")

    # Give WebView2 a moment to create the window, then point it at the local app.
    import threading

    threading.Timer(0.4, load_app).start()
    webview.start(debug=bool(os.environ.get("MM_WEBVIEW_DEBUG")), private_mode=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MindMeter desktop launcher")
    parser.add_argument("--dev", action="store_true", help="verbose local mode")
    parser.add_argument("--no-window", action="store_true", help="start backend only")
    parser.add_argument("--backend-port", type=int, default=0)
    parser.add_argument("--pg-port", type=int, default=0)
    args = parser.parse_args(argv)

    RUNTIME.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)

    mutex, first = single_instance()
    if not first:
        message_box("MindMeter 已经在运行。")
        return 0

    token = os.environ.get("MM_API_TOKEN") or secrets.token_urlsafe(32)
    backend_port = args.backend_port or free_port()
    pg_port = args.pg_port or free_port()
    backend = None
    postgres = None
    job = create_kill_on_close_job()
    try:
        check_vendor()
        initdb_with_fallback()
        log(f"starting PostgreSQL on 127.0.0.1:{pg_port}")
        postgres = start_postgres(pg_port)
        assign_to_job(job, postgres)
        ensure_database(pg_port)
        backup_before_migration(pg_port)
        run_migrations(pg_port)
        run_embedding_ingest(pg_port)
        log(f"starting FastAPI on 127.0.0.1:{backend_port}")
        backend = start_backend(backend_port, token, pg_port)
        assign_to_job(job, backend)
        health = wait_health(backend_port, token)
        log(f"health: {health}")

        if args.no_window:
            log("backend-only mode; press Ctrl+C to stop")
            while True:
                time.sleep(1)
        run_window(token, backend_port)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as exc:  # noqa: BLE001 - surface startup failures to the user
        log(f"startup failed: {exc}")
        if not args.no_window:
            message_box(f"MindMeter 启动失败：\n\n{exc}\n\n日志：{LOGS}")
        return 1
    finally:
        stop_process(backend, "backend")
        stop_postgres(pg_port)
        if IS_WINDOWS and job:
            ctypes.windll.kernel32.CloseHandle(job)
        if IS_WINDOWS and mutex:
            ctypes.windll.kernel32.CloseHandle(mutex)
        log("shutdown complete")


if __name__ == "__main__":
    raise SystemExit(main())
