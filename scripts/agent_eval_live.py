#!/usr/bin/env python3
"""真模型回归：需要站点已配置模型（MM_LLM_API_KEY）。

    python scripts/agent_eval_live.py --base-url http://127.0.0.1:8100

没配模型时直接跳过（退出码 0），所以可以放进 CI 而不必准备 Key。
输出：每次调用的 intent / source（llm 或 template）/ 延迟，以及模板回退率。
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid

import httpx

QUESTIONS = [
    "联想记忆为什么低",
    "这次怎么样",
    "我的认知有问题吗",
    "八个维度就是八种智力吧",
    "睡眠会影响成绩吗",
    "未测是什么意思",
    "下一步怎么练",
    "你能做什么",
]


def register(client: httpx.Client, base: str) -> str:
    username = "live" + uuid.uuid4().hex[:8]
    password = "Live-check-123"
    res = client.post(f"{base}/api/v1/auth/register", json={"username": username, "password": password, "adult": True})
    res.raise_for_status()
    return username


def seed(client: httpx.Client, base: str) -> None:
    session = {
        "id": "s_live",
        "mode": "standard",
        "finishedAt": "2026-11-20T10:00:00Z",
        "dims": ["vc", "ps", "sv", "am"],
        "results": {
            "vc": {"metrics": {"total": 6, "correct": 5}, "answers": []},
            "ps": {"metrics": {"correct": 19, "trials": 24, "wrong": 3, "seconds": 45}, "answers": []},
            "sv": {"metrics": {"total": 8, "correct": 7, "correctRts": [2000] * 7}, "answers": []},
            "am": {"metrics": {"hits": 4, "falseAlarms": 3}, "answers": []},
        },
    }
    client.post(f"{base}/api/v1/assessments", json={"session": session}).raise_for_status()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8100")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    with httpx.Client(timeout=60) as client:
        try:
            health = client.get(f"{base}/api/v1/health").json()
        except Exception as exc:  # noqa: BLE001
            print(f"服务不可达：{exc}")
            return 1
        ai = health.get("ai") or {}
        if not ai.get("enabled"):
            print("站点未配置模型（ai.enabled=false），跳过真模型回归。")
            return 0
        print(f"模型：{ai.get('model')}")

        register(client, base)
        seed(client, base)

        degraded = 0
        latencies: list[int] = []
        for question in QUESTIONS:
            started = time.perf_counter()
            reply = client.post(f"{base}/api/v1/chat", json={"question": question}).json()["reply"]
            ms = int((time.perf_counter() - started) * 1000)
            latencies.append(ms)
            source = reply.get("source")
            if source != "llm":
                degraded += 1
            print(f"  {question[:12]:12} intent={reply.get('intent'):10} source={source:8} {ms:5} ms")
        total = len(QUESTIONS)
        latencies.sort()
        print(
            f"\n真模型回退率：{degraded}/{total}（{degraded / total:.0%}）"
            f" · 中位延迟 {latencies[total // 2]} ms · 最大 {latencies[-1]} ms"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
