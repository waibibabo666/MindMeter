"""Runtime configuration for the local MindMeter backend.

The desktop launcher owns process lifecycle and passes the local API token and
database credentials through environment variables. Nothing here starts a
database, runs migrations, or reads an LLM key at import time.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MM_", extra="ignore")

    app_name: str = "MindMeter"
    app_version: str = "0.2.0"
    api_token: str = ""
    database_url: str = ""
    data_dir: Path = Path.home() / "MindMeter"
    frontend_dir: Path = Path(__file__).resolve().parents[2] / "frontend"
    pg_dump: str = ""
    pg_host: str = "127.0.0.1"
    pg_port: int = 0
    pg_user: str = "mm_app"
    pg_database: str = "mindmeter"
    pg_password: str = ""
    llm_timeout_s: float = 45.0
    rag_mode: str = "auto"  # auto | vector | keyword
    # 加载本地 embedding 模型最多等多久；超时直接回退 BM25，避免首个问答卡住。
    rag_load_timeout_s: float = 6.0
    # 检索结果的相关性门槛：低于该分数视为"知识库没有依据"。
    rag_min_score: float = 3.0

    @property
    def is_configured(self) -> bool:
        return bool(self.api_token and self.database_url)


settings = Settings()
