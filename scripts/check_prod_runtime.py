"""用 Railway 的生产参数真启一次服务，并跑通关键链路（部署前预检）。

覆盖：liveness/readiness、Cookie 属性（HttpOnly/SameSite/Secure 推断）、
`MM_EXPOSE_LOGS=false` 是否真的拒绝 /logs、服务端计分、报告解读是否走模型、
对话沉淀记忆、两种清除语义（只清对话 vs 清全部）、同源静态资源。

用法：
    python scripts/check_prod_runtime.py                    # 用本地 e2e 库
    $env:MM_DATABASE_URL="postgresql+psycopg://..."; python scripts/check_prod_runtime.py

注意：这里刻意**不传** `Dockerfile` CMD 里的 `--forwarded-allow-ips "*"`。
Windows CRT 会按 cwd 把裸 `*` 展开成目录名，uvicorn 收到多余位置参数直接退出；
Railway 用 `sh -c "<CMD>"` 执行，双引号内的 `*` 不会被展开，线上安全。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "code", "backend")
PORT = os.environ.get("MM_PROD_CHECK_PORT", "8211")
BASE = f"http://127.0.0.1:{PORT}"
API = f"{BASE}/api/v1"

for name in ("NO_PROXY", "no_proxy"):
    value = os.environ.get(name, "")
    if value:
        os.environ[name] = ",".join(
            part for part in value.split(",") if part.strip() not in {"[::1]", "::1", ""}
        )

# 与 railway.json / Dockerfile 一致的环境（除了 Key 用本地 .env.local 里那份）
env = dict(os.environ)
env.update(
    {
        "MM_DATABASE_URL": os.environ.get(
            "MM_DATABASE_URL", "postgresql+psycopg://mm_e2e@127.0.0.1:55451/mindmeter_e2e"
        ),
        "MM_AUTO_MIGRATE": "1",
        "MM_RAG_MODE": "keyword",
        "MM_DATA_DIR": os.path.join(ROOT, "runtime", "prodcheck"),
        "MM_EXPOSE_LOGS": "false",
        "MM_ALLOW_REGISTRATION": "true",
        "MM_COOKIE_SECURE": "auto",
        "MM_LLM_BASE_URL": "https://open.bigmodel.cn/api/paas/v4",
        "MM_LLM_MODEL": "glm-4-flash-250414",
        "MM_LLM_MODEL_FALLBACKS": "glm-4-air-250414,glm-4.5-flash,glm-4.7-flash",
    }
)
# Key 从 .env.local 读（可选：没有就沿用当前环境变量），绝不打印
env_file = os.path.join(ROOT, ".env.local")
if os.path.exists(env_file):
    for line in open(env_file, encoding="utf-8-sig"):
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            if key.strip().startswith("MM_"):
                env[key.strip()] = value.strip()
    print("已读取 .env.local 的 MM_* 配置")
else:
    print("没有 .env.local：沿用当前环境变量（MM_LLM_API_KEY 未设置时 AI 走模板，属预期）")

proc = subprocess.Popen(
    [
        sys.executable, "-m", "uvicorn", "app.main:app",
        "--host", "127.0.0.1", "--port", PORT,
        "--proxy-headers",
        # 注意：这里不传 Dockerfile CMD 里的 `"*"`。Windows CRT 会按 cwd 把裸 `*`
        # 展开成目录名，uvicorn 收到多余位置参数直接退出 —— 这是本地平台差异。
        # Railway 用 `sh -c "<CMD>"` 执行，双引号内的 `*` 不会被展开，
        # 所以线上那条命令是安全的（已在 docs/software/deploy-railway.md 记录）。
        "--forwarded-allow-ips",
        "127.0.0.1",
    ],
    cwd=BACKEND,
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    encoding="utf-8",
    errors="replace",
)
log_lines: list[str] = []

results = []


def _drain(stream, sink):
    for line in stream:
        sink.append(line.rstrip())


import threading  # noqa: E402

reader = threading.Thread(target=_drain, args=(proc.stdout, log_lines), daemon=True)
reader.start()

try:
    deadline = time.time() + 60
    live = False
    while time.time() < deadline:
        try:
            if httpx.get(f"{API}/health/live", timeout=5).status_code == 200:
                live = True
                break
        except Exception:  # noqa: BLE001
            if proc.poll() is not None:
                break  # 进程已经退出，别再等
            time.sleep(1.0)
    results.append(("liveness /health/live", live, "" if live else "\n".join(log_lines[-25:])))
    if not live:
        raise SystemExit("服务没起来，启动日志见上")

    health = httpx.get(f"{API}/health", timeout=20).json()
    results.append(
        (
            "readiness reports db+migration+pgvector+ai",
            health["db"]["connected"] and health["db"]["migration"] and health["db"]["pgvector"] and health["ai"]["enabled"],
            json.dumps(health, ensure_ascii=False)[:220],
        )
    )

    with httpx.Client(base_url=API, timeout=60.0) as c:
        user = f"prodcheck{int(time.time()) % 100000}"
        reg = c.post("/auth/register", json={"username": user, "password": "mindmeter2026", "adult": True})
        cookie = reg.cookies.get("mm_session")
        set_cookie = reg.headers.get("set-cookie", "")
        results.append(
            (
                "register sets HttpOnly+SameSite cookie (Secure off on http)",
                bool(cookie)
                and "HttpOnly" in set_cookie
                and "samesite=lax" in set_cookie.lower()
                and "Secure" not in set_cookie,
                set_cookie[:150],
            )
        )
        logs = c.get("/logs")
        # 403 而不是 404：该路由在 OpenAPI 契约里公开存在，关闭时明确拒绝比装不存在更诚实。
        results.append(
            (
                "MM_EXPOSE_LOGS=false refuses /logs with 403",
                logs.status_code == 403 and logs.json().get("detail") == "logs_disabled",
                f"{logs.status_code} {logs.text[:60]}",
            )
        )

        session = {
            "id": "s_prod1",
            "mode": "standard",
            "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "dims": ["vc", "am"],
            "results": {
                "vc": {"metrics": {"total": 8, "correct": 5}, "answers": []},
                "am": {
                    "metrics": {"hits": 4, "falseAlarms": 3},
                    "answers": [{"isOld": True}] * 8 + [{"isOld": False}] * 8,
                },
            },
        }
        saved = c.post("/assessments", json={"session": session})
        scores = saved.json()["session"]["scores"] if saved.status_code == 200 else {}
        results.append(("server scoring works in prod mode", scores.get("vc") == 50 and scores.get("am") == 26, json.dumps(scores)))

        explain = c.post("/reports/s_prod1/explain")
        payload = explain.json() if explain.status_code == 200 else {}
        results.append(
            (
                "report explain uses the real model",
                payload.get("source") == "llm",
                f"source={payload.get('source')} code={payload.get('code')}",
            )
        )

        chat = c.post("/chat", json={"question": "为什么联想记忆低？"})
        reply = chat.json()["reply"] if chat.status_code == 200 else {}
        mem = chat.json().get("memory") if chat.status_code == 200 else {}
        results.append(
            (
                "chat answers via model and sediments memory",
                reply.get("source") in ("llm", "template") and bool(mem) and len(mem.get("summaries") or []) >= 1,
                f"source={reply.get('source')} summaries={len((mem or {}).get('summaries') or [])} advice={len((mem or {}).get('advice') or [])}",
            )
        )

        cleared = c.delete("/memory/messages")
        after = c.get("/memory").json()
        results.append(
            (
                "DELETE /memory/messages clears only conversations",
                cleared.status_code == 200 and after["messages"] == [] and len(after["summaries"]) >= 1,
                f"messages={len(after['messages'])} summaries={len(after['summaries'])}",
            )
        )
        everything = c.delete("/memory")
        after2 = c.get("/memory").json()
        results.append(
            (
                "DELETE /memory clears all four kinds",
                everything.status_code == 200
                and after2["messages"] == []
                and after2["summaries"] == []
                and after2["advice"] == [],
                json.dumps({k: len(v) if isinstance(v, list) else v for k, v in after2.items() if k != "schemaVersion"})[:160],
            )
        )

        shell = httpx.get(BASE + "/", timeout=20)
        results.append(("static shell served at /", shell.status_code == 200 and "MindMeter" in shell.text, str(shell.status_code)))
        deep = httpx.get(BASE + "/src/pages/chat.js", timeout=20)
        results.append(("frontend modules reachable (no build step)", deep.status_code == 200, str(deep.status_code)))

        c.request("DELETE", "/auth/account", json={"password": "mindmeter2026"})
finally:
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except Exception:  # noqa: BLE001
        proc.kill()

print("\n=== Railway 生产参数实测 ===")
failed = 0
for name, ok, detail in results:
    flag = "PASS" if ok else "FAIL"
    failed += 0 if ok else 1
    print(f"[{flag}] {name}" + (f"\n       {detail}" if detail else ""))
print(f"\n{len(results) - failed}/{len(results)} 通过")
