import time
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.redis import get_redis
from app.config import Settings, get_settings
from app.core.errors import AuthError, RateLimitedError
from app.db.models import User
from app.db.session import get_db
from app.services import rate_limit
from app.services.oauth import JwksFetcher, fetch_jwks_http
from app.services.security import decode_access_token

DbSession = Annotated[AsyncSession, Depends(get_db)]
RedisClient = Annotated[Redis, Depends(get_redis)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

# auto_error=False: a missing header becomes our own 401 envelope, not FastAPI's 403.
_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    session: DbSession,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise AuthError("not_authenticated", "Sign in to continue")
    user_id = decode_access_token(credentials.credentials, settings)
    user = await session.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise AuthError("invalid_token", "Access token is invalid")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def client_ip(request: Request) -> str:
    # Behind a proxy, run uvicorn with --proxy-headers so this is the real client address.
    return request.client.host if request.client else "unknown"


async def enforce_login_rate_limit(
    request: Request, redis: RedisClient, settings: SettingsDep
) -> None:
    result = await rate_limit.hit(
        redis,
        f"rl:login:{client_ip(request)}",
        settings.login_rate_limit,
        settings.login_rate_window_s,
        now_ms=int(time.time() * 1000),
    )
    if not result.allowed:
        raise RateLimitedError(result.retry_after_s)


LoginRateLimit = Depends(enforce_login_rate_limit)


def get_jwks_fetcher() -> JwksFetcher:
    return fetch_jwks_http


JwksFetcherDep = Annotated[JwksFetcher, Depends(get_jwks_fetcher)]
