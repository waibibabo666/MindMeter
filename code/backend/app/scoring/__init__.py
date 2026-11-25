"""兼容 shim：计分引擎已移到 ``code/core_engine/scoring``。"""
from __future__ import annotations

from core_engine.scoring import *  # noqa: F401,F403
from core_engine.scoring import __all__  # noqa: F401
