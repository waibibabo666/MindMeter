"""MindMeter 后端包。

把 ``code/`` 加入 sys.path，使后端可以导入无框架核心引擎 ``core_engine.scoring``。"""

import sys
from pathlib import Path

# ``code/`` 存放无框架的核心引擎（计分、共享算法）。
# 加入 sys.path，使后端可以 ``import core_engine.scoring``；
# 无论从仓库（uvicorn）还是安装后的 wheel 运行。
_CODE_ROOT = Path(__file__).resolve().parents[2]
if str(_CODE_ROOT) not in sys.path:
    sys.path.append(str(_CODE_ROOT))
