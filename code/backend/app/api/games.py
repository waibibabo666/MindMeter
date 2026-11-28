"""按账号的练习游戏记录。"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..analysis import DIM_ORDER
from ..game_quality import evaluate
from ..models import GamePlay, GameRecord, User

router = APIRouter()

MAX_SCORE = 100
MAX_GAME_ID = 64


def _clamp_score(value) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(MAX_SCORE, number))


def _clean_id(raw: str) -> str:
    game_id = str(raw or "").strip()
    if not game_id or len(game_id) > MAX_GAME_ID:
        raise ValueError("invalid_game_id")
    return game_id


def _payload(rows) -> dict:
    records = {}
    for row in rows:
        records[row.game_id] = {
            "best": int(row.best or 0),
            "plays": int(row.plays or 0),
            "lastScore": int(row.last_score or 0),
            "lastAt": row.last_at.isoformat() if row.last_at else "",
        }
    return {"records": records}


@router.get("/games")
def list_games(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    """当前登录账号的全部游戏记录（从未玩过时为空）。"""
    rows = db.execute(
        select(GameRecord).where(GameRecord.user_id == int(user.id))
    ).scalars()
    return _payload(rows)


@router.post("/games/{game_id}")
def record_game(
    game_id: str,
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    """记录一轮已完成的游戏。最高分只增不减，次数始终累加。"""
    try:
        key = _clean_id(game_id)
    except ValueError:
        return {"ok": False, "reason": "invalid_game_id"}

    score = _clamp_score(payload.get("score"))
    row = db.get(GameRecord, (int(user.id), key))
    if row is None:
        row = GameRecord(
            user_id=int(user.id),
            game_id=key,
            best=score,
            plays=1,
            last_score=score,
            last_at=datetime.now(timezone.utc),
        )
        db.add(row)
    else:
        row.best = max(int(row.best or 0), score)
        row.plays = int(row.plays or 0) + 1
        row.last_score = score
        row.last_at = datetime.now(timezone.utc)
    # 单局流水用于游戏质量评估。它是旁路：写失败（例如还没迁移）不能影响玩家记分，
    # 所以放在 savepoint 里，出错只回滚这一笔。
    dim = str(payload.get("dim") or "")
    if dim in DIM_ORDER:
        try:
            with db.begin_nested():
                db.add(GamePlay(user_id=int(user.id), game_id=key, dim=dim, score=score))
        except Exception:  # noqa: BLE001
            pass
    db.commit()
    return _payload([row])


@router.get("/games/quality")
def games_quality(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    """各游戏的质量后验：区分度、天花板/地板、数据量。只含聚合，不含任何用户标识。"""
    rows = db.execute(
        select(GamePlay.user_id, GamePlay.game_id, GamePlay.dim, GamePlay.score).order_by(
            GamePlay.created_at, GamePlay.id
        )
    ).all()
    return {"games": evaluate((int(r[0]), r[1], r[2], float(r[3])) for r in rows)}


@router.delete("/games")
def clear_games(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    """删除本账号的全部游戏记录（报告不受影响）。"""
    db.execute(delete(GameRecord).where(GameRecord.user_id == int(user.id)))
    db.commit()
    return {"ok": True}
