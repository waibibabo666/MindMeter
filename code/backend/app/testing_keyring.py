"""Test-only in-memory keyring backend.

Used by CI/E2E so the suite never touches a developer's real Credential
Manager. Production never sets PYTHON_KEYRING_BACKEND to this module.
"""
from __future__ import annotations

from keyring.backend import KeyringBackend


class InMemoryKeyring(KeyringBackend):
    priority = 1

    _values: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self._values.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self._values[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        self._values.pop((service, username), None)
