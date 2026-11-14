"""scoring-v3.1 thresholds, ported from the frozen frontend implementation."""
from __future__ import annotations

SCORING_VERSION = "scoring-v3.1"
DIMENSION_IDS = ["vc", "vf", "nc", "ps", "ir", "sv", "am", "ni"]

CONFIG = {
    "minCompletion": 0.8,
    "vc": {"items": 6},
    "vf": {"floor": 10, "span": 20},
    "nc": {"items": 20},
    "ps": {"low": 8, "high": 24},
    "ir": {"items": 15},
    "sv": {
        "items": 8,
        "rtBest": 1500,
        "rtWorst": 4000,
        "minCorrect": 4,
        "minRt": 200,
        "wAcc": 0.7,
        "wRt": 0.3,
    },
    "ni": {"items": 20},
    "am": {"targets": 8, "foils": 8},
}
