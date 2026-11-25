"""账号：用户名/密码凭证、服务端会话与限流。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AuthSession, User

MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 128
MIN_USERNAME_LEN = 2
MAX_USERNAME_LEN = 32
USERNAME_RE = re.compile(r"^[a-z0-9一-鿿][a-z0-9._一-鿿-]{1,31}$")
COOKIE_PATH = "/"

# ---------------------------------------------------------------------------
# 凭证
# ---------------------------------------------------------------------------


def normalize_username(raw: object) -> str:
    return str(raw or "").strip().lower()


def hash_password(password: str, *, iterations: int = 240_000) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "$".join(
        (
            "pbkdf2-sha256",
            str(iterations),
            base64.b64encode(salt).decode(),
            base64.b64encode(digest).decode(),
        )
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt_b64, hash_b64 = str(stored or "").split("$")
        if scheme != "pbkdf2-sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        rounds = int(iterations or 0)
    except (ValueError, TypeError):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return hmac.compare_digest(digest, expected)


_DUMMY_HASH = ""


def dummy_hash() -> str:
    """始终返回真实且已缓存的哈希，使未知用户名与错误密码耗时一致。"""
    global _DUMMY_HASH
    if not _DUMMY_HASH:
        _DUMMY_HASH = hash_password("mindmeter-placeholder-1")
    return _DUMMY_HASH


def password_problems(password: str) -> list[str]:
    value = str(password or "")
    problems: list[str] = []
    if len(value) < MIN_PASSWORD_LEN:
        problems.append(f"密码至少 {MIN_PASSWORD_LEN} 位")
    if len(value) > MAX_PASSWORD_LEN:
        problems.append(f"密码最多 {MAX_PASSWORD_LEN} 位")
    if value and len(set(value)) < 3:
        problems.append("密码不要只由同一种字符组成")
    if value and not re.search(r"[A-Za-z一-鿿]", value):
        problems.append("密码至少包含一个字母")
    if value and not re.search(r"[0-9]", value):
        problems.append("密码至少包含一个数字")
    return problems


def credential_errors(username: str, password: str, confirm: str = "") -> list[str]:
    """返回人类可读的问题列表；为空表示输入可用。"""
    problems: list[str] = []
    name = normalize_username(username)
    if not name:
        problems.append("请填写用户名")
    elif not USERNAME_RE.match(name):
        problems.append(
            f"用户名 {MIN_USERNAME_LEN}–{MAX_USERNAME_LEN} 位，可用字母、数字、点、下划线或中文，且以字母、数字或中文开头"
        )
    problems.extend(password_problems(password))
    if confirm and confirm != password:
        problems.append("两次输入的密码不一致")
    return problems


# ---------------------------------------------------------------------------
# 账号
# ---------------------------------------------------------------------------


def get_user(db: Session, username: str) -> User | None:
    name = normalize_username(username)
    if not name:
        return None
    return db.scalar(select(User).where(User.username == name))


def create_user(db: Session, username: str, password: str) -> User:
    """插入新账号。是否允许注册、限流等策略由 API 层负责。"""
    name = normalize_username(username)
    problems = credential_errors(name, password)
    if problems:
        raise HTTPException(400, detail=";".join(problems))
    user = User(username=name, password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail="username_taken") from None
    db.refresh(user)
    return user


def check_login(db: Session, username: str, password: str) -> User:
    """返回用户或抛 401。未知用户也要付出一次 PBKDF2 的代价。"""
    user = get_user(db, username)
    if user is None:
        verify_password(str(password or ""), dummy_hash())
        raise HTTPException(401, detail="invalid_credentials")
    if not verify_password(str(password or ""), user.password_hash):
        raise HTTPException(401, detail="invalid_credentials")
    return user


def change_password(db: Session, user: User, old: str, new: str) -> None:
    if not verify_password(str(old or ""), user.password_hash):
        raise HTTPException(403, detail="wrong_password")
    problems = password_problems(new)
    if problems:
        raise HTTPException(400, detail=";".join(problems))
    user.password_hash = hash_password(new)
    # 「全端登出」是「撤销会话」的廉价且诚实的实现。
    revoke_all(db, user.id)
    db.commit()


def delete_account(db: Session, user: User) -> None:
    """硬删除；ON DELETE CASCADE 会清掉测评、记忆、对话与 AI 运行记录。"""
    db.delete(user)
    db.commit()


# ---------------------------------------------------------------------------
# 会话
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def token_hash(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def issue_session(db: Session, user: User, request: Request | None = None) -> str:
    token = secrets.token_urlsafe(32)
    ttl = timedelta(days=max(1, settings.session_ttl_days))
    db.add(
        AuthSession(
            token_hash=token_hash(token),
            user_id=user.id,
            expires_at=_now() + ttl,
            ip=client_ip_of(request, ""),
            user_agent=(request.headers.get("user-agent", "")[:200] if request else None),
        )
    )
    user.last_login_at = _now()
    db.commit()
    return token


def read_session(db: Session, request: Request) -> tuple[User, AuthSession] | None:
    token = request.cookies.get(settings.cookie_name, "")
    if not token:
        return None
    row = db.get(AuthSession, token_hash(token))
    if row is None or row.expires_at is None:
        return None
    if row.expires_at.tzinfo is None:
        row.expires_at = row.expires_at.replace(tzinfo=timezone.utc)
    if row.expires_at <= _now():
        db.delete(row)
        db.commit()
        return None
    user = db.get(User, row.user_id)
    if user is None:
        return None
    # 滑动续期，但只有在能省下超过一分钟的写操作时才落库。
    if row.last_seen_at.tzinfo is None:
        row.last_seen_at = row.last_seen_at.replace(tzinfo=timezone.utc)
    if _now() - row.last_seen_at > timedelta(minutes=5):
        row.last_seen_at = _now()
        row.expires_at = _now() + timedelta(days=max(1, settings.session_ttl_days))
        db.commit()
    return user, row


def revoke(db: Session, request: Request) -> None:
    token = request.cookies.get(settings.cookie_name, "")
    if not token:
        return
    db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(token)))
    db.commit()


def revoke_all(db: Session, user_id: int) -> int:
    result = db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    return int(result.rowcount or 0)


def purge_expired_sessions(db: Session) -> int:
    result = db.execute(delete(AuthSession).where(AuthSession.expires_at <= _now()))
    db.commit()
    return int(result.rowcount or 0)


# ---------------------------------------------------------------------------
# 请求处理管线
# ---------------------------------------------------------------------------


def client_ip_of(request: Request | None, fallback: str = "") -> str:
    if request is None:
        return fallback or "local"
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = request.client
    return (client.host if client else "") or fallback or "unknown"


def wants_secure_cookie(request: Request) -> bool:
    mode = str(settings.cookie_secure or "auto").lower()
    if mode in {"true", "1", "yes"}:
        return True
    if mode in {"false", "0", "no"}:
        return False
    scheme = (
        request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
        or (request.url.scheme or "")
    )
    host = request.url.hostname or ""
    return scheme == "https" or host.endswith((".onrender.com", ".up.railway.app"))


def apply_session_cookie(response, token: str, secure: bool) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=max(1, settings.session_ttl_days) * 86400,
        path=COOKIE_PATH,
        httponly=True,
        samesite="lax",
        secure=secure,
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(key=settings.cookie_name, path=COOKIE_PATH, samesite="lax")


class _Throttle:
    """进程内固定窗口计数器：单进程，课程演示够用。"""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, window_s: int, max_attempts: int) -> bool:
        """返回 True 表示该次尝试被拦截。"""
        if max_attempts <= 0 or window_s <= 0:
            return False
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 4096:  # never let a probe flood grow the map
                self._hits.clear()
            bucket = [t for t in self._hits.get(key, []) if now - t < window_s]
            bucket.append(now)
            self._hits[key] = bucket
            return len(bucket) > max_attempts

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


_throttle = _Throttle()


def throttle_hit(key: str, window_s: int, max_attempts: int) -> bool:
    return _throttle.hit(key, window_s, max_attempts)


def throttle_reset(key: str) -> None:
    _throttle.reset(key)


def login_throttle_key(request: Request, username: str) -> str:
    return f"login:{client_ip_of(request)}:{normalize_username(username)}"


# ---------------------------------------------------------------------------
# 依赖
# ---------------------------------------------------------------------------


def optional_user(
    request: Request, db: Session = Depends(get_db)
) -> User | None:
    pair = read_session(db, request)
    return pair[0] if pair else None


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    pair = read_session(db, request)
    if pair is None:
        raise HTTPException(401, detail="unauthenticated")
    return pair[0]


def require_user_id(user: User = Depends(require_user)) -> int:
    return int(user.id)
