"""MindMeter backend package."""

import sys
from pathlib import Path

# ``code/`` holds the framework-free core engine (scoring, shared algorithms).
# Add it to the path so ``import core_engine.scoring`` works from the backend
# whether it runs from the repo (uvicorn) or from an installed wheel.
_CODE_ROOT = Path(__file__).resolve().parents[2]
if str(_CODE_ROOT) not in sys.path:
    sys.path.append(str(_CODE_ROOT))
