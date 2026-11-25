"""Compatibility shim: the scoring engine lives in ``code/core_engine/scoring``.

Keeping this module means existing imports (``from .scoring import ...`` and
``from app.scoring import ...`` in tests) keep working while the implementation
moves to the framework-free core engine.
"""
from __future__ import annotations

from core_engine.scoring import *  # noqa: F401,F403
from core_engine.scoring import __all__  # noqa: F401
