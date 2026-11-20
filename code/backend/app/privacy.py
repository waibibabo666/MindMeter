"""Small PII guard for chat input.

The product deliberately does not collect phone numbers or national IDs. If a
user pastes one, we redact it before storage and do not send the turn to a
model. This is a safety net, not a general DLP system.
"""
from __future__ import annotations

import re

PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
ID_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


def find_sensitive(text: str) -> list[str]:
    value = str(text or "")
    found: list[str] = []
    for name, pattern in (("手机号", PHONE_RE), ("身份证号", ID_RE), ("邮箱", EMAIL_RE)):
        if pattern.search(value):
            found.append(name)
    return found


def redact(text: str) -> str:
    value = str(text or "")
    value = PHONE_RE.sub("[手机号已隐藏]", value)
    value = ID_RE.sub("[身份证号已隐藏]", value)
    value = EMAIL_RE.sub("[邮箱已隐藏]", value)
    return value
