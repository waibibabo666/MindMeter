"""Start/stop the MindMeter web app as detached local processes.

Why this exists: `python scripts/e2e_server.py` runs in the foreground, so the
site disappears when that terminal (or the agent job that owns it) goes away.
Manual testing needs something that stays up across turns and lets you browse
http://127.0.0.1:8000 while the code is edited.

    python scripts/dev_serve.py start [--port 8000] [--reload]
    python scripts/dev_serve.py status
    python scripts/dev_serve.py stop
    python scripts/dev_serve.py url

It reuses the one-off PostgreSQL cluster from e2e_server (runtime/e2e), applies
migrations, and writes logs + PIDs under runtime/dev so nothing is guesswork.
Detached on Windows via DETACHED_PROCESS, so closing this shell keeps the site.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
BACKEND = ROOT / "code" / "backend"
STATE = ROOT / "runtime" / "dev"
INFO = STATE / "serve.json"
DEFAULT_PORT = 8000

sys.path.insert(0, str(SCRIPTS))
import e2e_server as e2e  # noqa: E402  (shared cluster/migration helpers)

DETACH = 0x00000008 | 0x00000200 if os.name == "nt" else 0  # DETACHED_PROCESS | NEW_PROCESS_GROUP


def _spawn(command: list[str], log_path: Path, cwd: Path, env: dict | None = None) -> subprocess.Popen:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handle = log_path.open("a", encoding="utf-8")
    return subprocess.Popen(
        command, cwd=str(cwd), stdout=handle, stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL, creationflags=DETACH, env=env,
    )


def _alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True
        )
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def pg_running() -> bool:
    """Truth is "can I connect?", not "is the pid I remembered alive?".

    The postmaster can be a leftover from an earlier run (different pid), and a
    spawn attempt on a busy port dies immediately — so probe with pg_isready and
    read the real pid from postmaster.pid.
    """
    try:
        probe = subprocess.run(
            [
                e2e.pg_bin("pg_isready"), "-h", "127.0.0.1",
                "-p", str(e2e.PG_PORT), "-U", e2e.PG_USER,
            ],
            capture_output=True,
        )
    except SystemExit:  # vendor/pgsql missing
        return False
    return probe.returncode == 0


def postmaster_pid() -> int:
    pid_file = e2e.PGDATA / "postmaster.pid"
    try:
        return int(pid_file.read_text(encoding="utf-8").splitlines()[0].strip())
    except (OSError, ValueError, IndexError):
        return 0


def _read_info() -> dict:
    if not INFO.exists():
        return {}
    try:
        return json.loads(INFO.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def _wait_http(url: str, seconds: float = 40.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        probe = subprocess.run(
            [sys.executable, "-c",
             f"import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('{url}',timeout=2).status==200 else 1)"],
            capture_output=True,
        )
        if probe.returncode == 0:
            return True
        time.sleep(1.0)
    return False


def status() -> dict:
    info = _read_info()
    db_up = pg_running()
    pg_pid = postmaster_pid() or int(info.get("pg_pid") or 0)
    web_pid = int(info.get("web_pid") or 0)
    return {
        "database": {"pid": pg_pid if db_up else None, "up": db_up, "url": info.get("db_url"), "port": e2e.PG_PORT},
        "web": {"pid": web_pid if _alive(web_pid) else None, "up": _alive(web_pid), "url": info.get("web_url"), "log": str(info.get("web_log"))},
    }


def env_fingerprint(path: Path | None) -> str:
    """配置文件的 mtime+size：变了就必须重启，环境变量只在进程启动时读一次。"""
    if not path:
        return ""
    try:
        stat = path.stat()
        return f"{int(stat.st_mtime)}:{stat.st_size}"
    except OSError:
        return ""


def stop_web_only() -> None:
    info = _read_info()
    web_pid = int(info.get("web_pid") or 0)
    if web_pid and _alive(web_pid):
        subprocess.run(["taskkill", "/PID", str(web_pid), "/T", "/F"], capture_output=True)
        time.sleep(1.0)
        print(f"已停止站点进程 web:{web_pid}（数据库保持运行）")


def read_env_file(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE lines leniently (export prefix, quotes, comments, BOM)."""
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        if stripped.startswith("export "):
            stripped = stripped[len("export "):].strip()
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def start(port: int, reload: bool, llm_key_file: Path | None) -> int:
    STATE.mkdir(parents=True, exist_ok=True)
    current = status()

    if reload:
        # uvicorn 的 reloader 用 CTRL_C_EVENT 重启子进程，分离进程没有控制台，
        # 会抛 OSError[WinError 6] 并留下一个跑旧代码的 worker（实测踩过：
        # 新加的 profile 列被旧模型静默丢掉）。分离启动因此拒绝 --reload。
        print("⚠ --reload 只适用于前台运行（python scripts/e2e_server.py）；"
              "分离进程请用：python scripts/dev_serve.py restart")
        reload = False

    fingerprint = env_fingerprint(llm_key_file)
    stale_env = current["web"]["up"] and _read_info().get("env_fingerprint", "") != fingerprint
    if stale_env:
        # 这是「.env.local 填好了但 ai.enabled 还是 false」的根因：进程比配置早启动。
        print("检测到配置文件变化（或服务在配置之前启动），重启站点进程以重新读取…")
        stop_web_only()
        current = status()

    if not current["database"]["up"]:
        e2e.init_cluster()
        pg = e2e.start_postgres()
        print(f"postgreSQL up pid={pg.pid} port={e2e.PG_PORT}")
    else:
        print(f"postgreSQL 已在运行 pid={current['database']['pid']} port={e2e.PG_PORT}")
    e2e.ensure_database()
    db_url = e2e.pg_url()
    e2e.migrate(db_url)
    print(f"migrations applied -> {db_url}")

    if current["web"]["up"] and int(current["web"]["pid"] or 0) != 0:
        print(f"web already up: {current['web']['url']} (pid {current['web']['pid']})")
        return 0

    env = dict(os.environ)
    env.update(
        {
            "MM_DATABASE_URL": db_url,
            "MM_AUTO_MIGRATE": "0",  # applied above, once
            "MM_RAG_MODE": os.environ.get("MM_RAG_MODE", "keyword"),
            "MM_DATA_DIR": str(STATE),
            "MM_EXPOSE_LOGS": "true",
        }
    )
    loaded: list[str] = []
    ignored: list[str] = []
    if llm_key_file and llm_key_file.exists():
        for key, value in read_env_file(llm_key_file).items():
            if key.startswith("MM_"):
                env[key] = value
                loaded.append(key)
            else:
                ignored.append(key)
        print(f"从 {llm_key_file.name} 读入 {len(loaded)} 个 MM_ 变量"
              + (f"；忽略非 MM_ 前缀的 {ignored}" if ignored else ""))
    if not env.get("MM_LLM_API_KEY"):
        print("MM_LLM_API_KEY 为空：AI 解读走模板。"
              "启用方式——在仓库根目录 .env.local 写 MM_LLM_API_KEY=...，再 restart")

    command = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)]
    if reload:
        command.append("--reload")
    web_log = STATE / "uvicorn.log"
    web = _spawn(command, web_log, BACKEND, env)
    print(f"web starting pid={web.pid} log={web_log}")

    url = f"http://127.0.0.1:{port}"
    if not _wait_http(f"{url}/api/v1/health/live"):
        print(f"FAILED to answer on {url}; see {web_log}")
        return 1

    INFO.write_text(
        json.dumps(
            {
                "pg_pid": postmaster_pid(),
                "web_pid": web.pid,
                "db_url": db_url,
                "web_url": url,
                "web_log": str(web_log),
                "env_fingerprint": fingerprint,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n✅ MindMeter 已在 {url} 运行（数据库 {db_url}）")

    # 直接把模型状态打出来，省得再猜「我到底生效了没有」。
    try:
        import urllib.request

        with urllib.request.urlopen(f"{url}/api/v1/health", timeout=10) as response:
            body = json.loads(response.read().decode("utf-8"))
        ai = body.get("ai") or {}
        state = "真实模型已生效" if ai.get("enabled") else "模板兜底（未配置或 Key 无效）"
        print(f"   AI：{state} · model={ai.get('model')} · migration={body.get('db', {}).get('migration')}")
        if not ai.get("enabled") and env.get("MM_LLM_API_KEY"):
            print("   已读到 Key 但仍未生效：检查 MM_LLM_BASE_URL / MM_LLM_MODEL，"
                  "或在设置页点「测试连接」看具体错误码")
    except Exception as error:  # noqa: BLE001
        print(f"   （没读到 /health：{error.__class__.__name__}）")

    print("   浏览器打开它注册账号即可；停止：python scripts/dev_serve.py stop")
    return 0


def stop() -> int:
    info = _read_info()
    stopped = []
    web_pid = int(info.get("web_pid") or 0)
    if web_pid and _alive(web_pid):
        subprocess.run(["taskkill", "/PID", str(web_pid), "/T", "/F"], capture_output=True)
        stopped.append(f"web:{web_pid}")
    if e2e.PGDATA.exists():
        e2e.stop_cluster()
        stopped.append("postgres")
    INFO.unlink(missing_ok=True)
    print("已停止：" + (", ".join(stopped) if stopped else "没有运行中的进程"))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "restart", "stop", "status", "url", "logs"])
    parser.add_argument("--port", type=int, default=int(os.environ.get("MM_DEV_PORT", DEFAULT_PORT)))
    parser.add_argument("--reload", action="store_true", help="仅前台运行可用（分离进程会崩）")
    parser.add_argument("--env-file", default=".env.local", help="读取 MM_* 模型配置的文件（gitignore 内）")
    args = parser.parse_args()

    env_file = ROOT / args.env_file
    if args.action == "restart":
        stop_web_only()
        return start(args.port, args.reload, env_file)
    if args.action == "start":
        return start(args.port, args.reload, env_file)
    if args.action == "stop":
        return stop()
    if args.action == "logs":
        log = STATE / "uvicorn.log"
        tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-40:] if log.exists() else []
        print("\n".join(tail) or f"还没有日志：{log}")
        return 0
    info = status()
    print(json.dumps(info, indent=2, ensure_ascii=False))
    if args.action == "url":
        url = (info["web"] or {}).get("url")
        if url and info["web"]["up"]:
            print(url)
            return 0
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
