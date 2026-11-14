"""Windows Credential Manager access via keyring (no plaintext fallback)."""
from __future__ import annotations

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

SERVICE = "MindMeter"
LLM_USER = "llm-api-key"


class KeyStoreError(RuntimeError):
    pass


def _backend_name() -> str:
    try:
        return keyring.get_keyring().__class__.__name__
    except Exception:
        return "unknown"


def available() -> bool:
    try:
        # A read is enough to verify a usable backend; None is a valid value.
        keyring.get_password(SERVICE, "__probe__")
        return True
    except KeyringError:
        return False


def get_secret(user: str) -> str | None:
    try:
        return keyring.get_password(SERVICE, user)
    except KeyringError as exc:
        raise KeyStoreError(f"keyring unavailable: {_backend_name()}") from exc


def set_secret(user: str, value: str) -> None:
    try:
        keyring.set_password(SERVICE, user, value)
    except KeyringError as exc:
        raise KeyStoreError(f"keyring unavailable: {_backend_name()}") from exc


def delete_secret(user: str) -> None:
    try:
        keyring.delete_password(SERVICE, user)
    except PasswordDeleteError:
        return
    except KeyringError as exc:
        raise KeyStoreError(f"keyring unavailable: {_backend_name()}") from exc


def get_llm_key() -> str | None:
    return get_secret(LLM_USER)


def set_llm_key(value: str) -> None:
    set_secret(LLM_USER, value)


def delete_llm_key() -> None:
    delete_secret(LLM_USER)


def mask_key(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    if len(value) <= 8:
        return "已保存"
    return f"{value[:3]}…{value[-4:]}"
