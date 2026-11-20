"""Runtime configuration for the hosted MindMeter backend.

Everything comes from the environment (prefix ``MM_``), which is what a Render
web service gives you: ``MM_DATABASE_URL`` from the provisioned Postgres and
``MM_LLM_*`` for the site-provided OpenAI-compatible model. No key is ever read
from a local credential store, and no key is stored in the database.

Importing this module never starts a database and never runs migrations.
"""
from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_LLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
DEFAULT_LLM_MODEL = "glm-4.7-flash"


def _data_dir() -> Path:
    """Writable scratch dir for logs; ephemeral on Render, so keep it small."""
    raw = os.environ.get("MM_DATA_DIR", "").strip()
    if raw:
        return Path(raw)
    if os.environ.get("RENDER", "").strip():
        return Path("/tmp/mindmeter")
    return Path.home() / "MindMeter"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MM_", extra="ignore")

    app_name: str = "MindMeter"
    app_version: str = "0.3.1"

    # --- storage -----------------------------------------------------------
    database_url: str = ""
    data_dir: Path = _data_dir()
    frontend_dir: Path = Path(__file__).resolve().parents[2] / "frontend"

    # --- site-provided LLM (OpenAI-compatible chat completions) ------------
    llm_base_url: str = DEFAULT_LLM_BASE_URL
    llm_model: str = DEFAULT_LLM_MODEL
    llm_api_key: str = ""
    llm_timeout_s: float = 45.0
    llm_max_tokens: int = 800
    llm_temperature: float = 0.2

    # --- accounts ----------------------------------------------------------
    allow_registration: bool = True
    session_ttl_days: int = 30
    cookie_name: str = "mm_session"
    cookie_secure: str = "auto"  # auto | true | false
    login_window_s: int = 300
    login_max_attempts: int = 10
    register_window_s: int = 3600
    register_max_attempts: int = 50  # generous: a campus/hotel NAT is one IP

    # --- retrieval ---------------------------------------------------------
    rag_mode: str = "keyword"  # auto | vector | keyword
    expose_logs: bool = False  # shared host: never stream server logs to clients

    @property
    def is_configured(self) -> bool:
        return bool(self.database_url)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key and self.llm_base_url and self.llm_model)

    @property
    def llm_endpoint(self) -> str:
        base = str(self.llm_base_url or "").strip().rstrip("/")
        if not base:
            return ""
        if base.lower().endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"


settings = Settings()
