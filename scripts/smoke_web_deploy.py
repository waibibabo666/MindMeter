#!/usr/bin/env python3
"""End-to-end smoke check against a deployed MindMeter web app.

    python scripts/smoke_web_deploy.py https://mindmeter-web.onrender.com

Checks the parts that only break in a real deployment: the public health
probe, cookie sessions, per-account isolation, the static shell, and that no
model key is ever echoed to the client. Registration is required for the data
steps; pass ``--no-register`` against a deployment with MM_ALLOW_REGISTRATION=0.

Exit code is 0 only when every check passes.
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time

import httpx


def _clean_no_proxy() -> None:
    """httpx 0.28 cannot parse bracketed IPv6 entries in NO_PROXY (Windows dev shells)."""
    for name in ("NO_PROXY", "no_proxy"):
        value = os.environ.get(name, "")
        if value:
            os.environ[name] = ",".join(
                part for part in value.split(",") if part.strip() not in {"[::1]", "::1", ""}
            )


_clean_no_proxy()

GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"

checks: list[tuple[str, bool, str]] = []


def report(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, ok, detail))
    mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"{mark}  {name}{(' — ' + detail) if detail and not ok else ''}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", nargs="?", default="http://127.0.0.1:8000")
    parser.add_argument("--no-register", action="store_true")
    parser.add_argument("--retries", type=int, default=10, help="wait for a cold free instance")
    args = parser.parse_args()

    base = args.base_url.rstrip("/") + "/"
    api = base.rstrip("/") + "/api/v1"
    password = "smoke-passw0rd-" + secrets.token_hex(3)
    username = "smoke_" + secrets.token_hex(4)

    with httpx.Client(timeout=httpx.Timeout(30.0, connect=15.0), follow_redirects=True) as probe:
        health = None
        for attempt in range(args.retries):
            try:
                health = probe.get(f"{api}/health/live")
                if health.status_code == 200:
                    break
            except httpx.HTTPError as exc:
                print(f"  ... waiting for service ({exc.__class__.__name__})")
            time.sleep(3 + attempt)
    if health is None or health.status_code != 200:
        print(f"{RED}服务不可达{RESET}：{base}")
        return 1
    report("liveness /api/v1/health/live", health.json().get("status") == "alive", health.text)

    with httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0), follow_redirects=True) as a:
        readiness = a.get(f"{api}/health")
        body = readiness.json() if readiness.status_code == 200 else {}
        report(
            "readiness /api/v1/health (db + migration)",
            body.get("status") == "ok" and bool(body.get("db", {}).get("migration")),
            readiness.text[:200],
        )
        print("     " + json.dumps(body, ensure_ascii=False)[:300])

        shell = a.get(base)
        report(
            "static shell served at /",
            shell.status_code == 200 and "MindMeter" in shell.text and "src/app.js" in shell.text,
            f"HTTP {shell.status_code}",
        )
        headers = shell.headers
        report(
            "security headers (CSP / nosniff / frame)",
            "script-src 'self'" in headers.get("content-security-policy", "")
            and headers.get("x-content-type-options") == "nosniff",
            str(dict(headers)),
        )

        if args.no_register:
            report("smoke: register skipped", True)
            return finish()

        registered = a.post(
            f"{api}/auth/register",
            json={"username": username, "password": password, "adult": True},
        )
        report(
            "register sets an HttpOnly SameSite cookie",
            registered.status_code == 200 and "httponly" in registered.headers.get("set-cookie", "").lower()
            and "samesite=lax" in registered.headers.get("set-cookie", "").lower(),
            registered.text[:200],
        )
        report(
            "session probe is authenticated and leaks no secret",
            a.get(f"{api}/auth/session").json().get("authenticated") is True
            and password not in a.get(f"{api}/auth/session").text,
        )

        anon = httpx.Client(timeout=30.0, base_url=api)
        blocked = anon.get("/state")
        report("anonymous /state is 401", blocked.status_code == 401, blocked.text)
        blocked_post = anon.post(
            "/chat", json={"question": "hi"}, headers={"Origin": "https://evil.example"}
        )
        report("cross-origin write is refused", blocked_post.status_code == 403, blocked_post.text)
        anon.close()

        saved = a.post(
            f"{api}/assessments",
            json={
                "session": {
                    "id": "s_smoke_1",
                    "mode": "standard",
                    "finishedAt": "2026-11-19T01:00:00Z",
                    "dims": ["vc", "ps", "sv", "am"],
                    "results": {
                        "vc": {"metrics": {"total": 6, "correct": 6}, "answers": []},
                        "ps": {"metrics": {"correct": 20}, "answers": []},
                        "sv": {
                            "metrics": {"total": 8, "correct": 8, "correctRts": [1500] * 8},
                            "answers": [],
                        },
                        "am": {
                            "metrics": {"hits": 8, "falseAlarms": 0},
                            "answers": [{"isOld": True}] * 8 + [{"isOld": False}] * 8,
                        },
                    },
                }
            },
        )
        scores = saved.json().get("session", {}).get("scores", {}) if saved.status_code == 200 else {}
        report("server-side scoring on POST /assessments", scores.get("vc") == 100, saved.text[:200])

        explained = a.post(f"{api}/reports/s_smoke_1/explain")
        payload = explained.json() if explained.status_code == 200 else {}
        report(
            "report explain answers (llm or template)",
            explained.status_code == 200 and bool(payload.get("text")),
            explained.text[:200],
        )
        if payload.get("source") == "llm":
            print(f"     模型解读生效：{payload.get('source')} / {payload.get('code')}")
        else:
            print(f"     模板兜底：{payload.get('reason') or payload.get('code')}（填 MM_LLM_API_KEY 后走模型）")

        chat = a.post(f"{api}/chat", json={"question": "为什么联想记忆低？"})
        report(
            "chat replies and keeps history",
            chat.status_code == 200 and len(chat.json().get("messages", [])) >= 2,
            chat.text[:200],
        )

        exported = a.get(f"{api}/export")
        report(
            "export has the session and no key",
            exported.status_code == 200
            and "s_smoke_1" in exported.text
            and "apiKey" not in exported.text
            and "sk-" not in exported.text,
            exported.text[:200],
        )

        with httpx.Client(timeout=60.0, follow_redirects=True) as b:
            b.post(f"{api}/auth/register", json={"username": username + "_b", "password": password, "adult": True})
            other = b.get(f"{api}/assessments/s_smoke_1")
            report("other account cannot read it (404)", other.status_code == 404, other.text)
            mine = b.get(f"{api}/assessments")
            report("other account sees no sessions", mine.json().get("sessions") == [], mine.text[:200])

        settings = a.get(f"{api}/settings/ai")
        report(
            "AI settings are read-only and key-free",
            settings.status_code == 200
            and settings.json().get("readOnly") is True
            and "key" not in settings.json(),
            settings.text[:200],
        )
        write_attempt = a.put(f"{api}/settings/ai", json={"model": "x"})
        report(
            "PUT /settings/ai is refused",
            write_attempt.status_code == 403 and write_attempt.json().get("detail") == "ai_managed_by_site",
            write_attempt.text[:200],
        )

        report("logout clears the session", a.post(f"{api}/auth/logout", json={}).status_code == 200)
        report(
            "after logout /auth/me is 401",
            a.get(f"{api}/auth/me").status_code == 401,
        )

        erased = a.post(f"{api}/auth/login", json={"username": username, "password": password})
        if erased.status_code == 200:
            a.request("DELETE", f"{api}/auth/account", json={"password": password})
            gone = a.post(f"{api}/auth/login", json={"username": username, "password": password})
            report("delete account removes the credential", gone.status_code == 401, gone.text)

    return finish()


def finish() -> int:
    failed = [name for name, ok, _ in checks if not ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
    if failed:
        print("失败项：" + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
