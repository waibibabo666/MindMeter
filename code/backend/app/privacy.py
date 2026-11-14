"""Redact personal data before it is stored, displayed or exported.

The assistant runs locally, but chat turns are persisted in PostgreSQL and are
included in the "导出数据" JSON. Phone numbers and ID card numbers must not
survive that round trip, otherwise a screenshot or an exported file leaks them.
"""
from __future__ import annotations

import re

# 18-digit mainland ID card: keep the region prefix and the last 4 characters.
ID_CARD_RE = re.compile(r"(?<!\d)(\d{6})\d{8}(\d{3}[\dXx])(?!\d)")
# 11-digit mobile number: keep the first 3 and last 4 digits.
PHONE_RE = re.compile(r"(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)")


def redact_pii(value: object) -> str:
    """Return the text with phone / ID numbers masked in place."""
    text = str(value or "")
    if not text:
        return ""
    text = ID_CARD_RE.sub(r"\1********\2", text)
    return PHONE_RE.sub(r"\1****\2", text)


def contains_pii(value: object) -> bool:
    text = str(value or "")
    return bool(ID_CARD_RE.search(text) or PHONE_RE.search(text))
