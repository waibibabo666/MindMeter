"""脱敏日志：本地写轮转文件，托管环境写 stdout。"""
from __future__ import annotations

import logging
import os
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


def _add_stream_handler(logger: logging.Logger) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    handler.addFilter(RedactionFilter())
    logger.addHandler(handler)


def _add_file_handler(logger: logging.Logger, data_dir: Path) -> bool:
    try:
        log_dir = Path(data_dir) / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            log_dir / "backend.log", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
    except OSError:
        return False
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    handler.addFilter(RedactionFilter())
    logger.addHandler(handler)
    return True


def setup_logging(data_dir: Path) -> logging.Logger:
    logger = logging.getLogger("mindmeter")
    logger.setLevel(logging.INFO)
    if logger.handlers:
        return logger

    hosted = bool(os.environ.get("RENDER", "").strip())
    if hosted:
        _add_stream_handler(logger)
        _add_file_handler(logger, data_dir)
    else:
        if not _add_file_handler(logger, data_dir):
            _add_stream_handler(logger)
    logger.propagate = False

    for noisy in ("httpx", "httpcore", "httpcore2", "httpx2", "sqlalchemy.engine", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return logger


def redact_text(text: str) -> str:
    text = SK_RE.sub("[redacted]", str(text or ""))
    text = BEARER_RE.sub("Bearer [redacted]", text)
    return SECRET_KEY_RE.sub(lambda m: f"{m.group(1)}=[redacted]", text)
