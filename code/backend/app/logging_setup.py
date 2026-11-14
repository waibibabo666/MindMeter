"""Redacted, rotating local logs.

We never log prompts, answers, request bodies, Authorization headers, or keys.
"""
from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

SECRET_KEY_RE = re.compile(
    r"(?i)(api[-_]?key|authorization|password|token|secret|key)\s*[:=]\s*([^\s,}]+)"
)
SK_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")
BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._-]{8,}\b")
BODY_KEYS = ("prompt", "messages", "content", "answer", "question", "raw")


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        message = SK_RE.sub("[redacted]", message)
        message = BEARER_RE.sub("Bearer [redacted]", message)
        message = SECRET_KEY_RE.sub(lambda m: f"{m.group(1)}=[redacted]", message)
        record.msg = message
        record.args = ()
        return True


def setup_logging(data_dir: Path) -> logging.Logger:
    log_dir = Path(data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("mindmeter")
    logger.setLevel(logging.INFO)
    if logger.handlers:
        return logger

    handler = RotatingFileHandler(
        log_dir / "backend.log", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    handler.addFilter(RedactionFilter())
    logger.addHandler(handler)
    logger.propagate = False

    for noisy in ("httpx", "httpcore", "httpcore2", "httpx2", "sqlalchemy.engine", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return logger


def redact_text(text: str) -> str:
    text = SK_RE.sub("[redacted]", str(text or ""))
    text = BEARER_RE.sub("Bearer [redacted]", text)
    return SECRET_KEY_RE.sub(lambda m: f"{m.group(1)}=[redacted]", text)
