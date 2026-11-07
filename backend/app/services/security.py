"""Password hashing and token primitives. Pure functions, no database or network access."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.core.errors import AuthError

ACCESS_TOKEN_TYPE = "access"
JWT_ALGORITHM = "HS256"


@lru_cache
def password_hasher(fast: bool = False) -> PasswordHasher:
    """argon2id with the library's RFC 9106 defaults. `fast` is for tests only."""
    if fast:
        return PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)
    return PasswordHasher()


def hasher_for(settings: Settings) -> PasswordHasher:
    return password_hasher(fast=settings.environment == "test")


@lru_cache
def _dummy_hash(hasher: PasswordHasher) -> str:
    return hasher.hash(secrets.token_urlsafe(16))


async def hash_password(password: str, hasher: PasswordHasher) -> str:
    # argon2 is deliberately slow (~50 ms); keep it off the event loop.
    return await run_in_threadpool(hasher.hash, password)


async def verify_password(
    password: str, password_hash: str | None, hasher: PasswordHasher
) -> tuple[bool, bool]:
    """Return (matches, needs_rehash).

    With no stored hash (unknown email, or a Google/Apple-only account) this still runs one
    verification against a dummy hash, so response time does not reveal whether the account
    exists.
    """
    if password_hash is None:
        await run_in_threadpool(_verify_quietly, hasher, _dummy_hash(hasher), password)
        return False, False
    matches = await run_in_threadpool(_verify_quietly, hasher, password_hash, password)
    return matches, matches and hasher.check_needs_rehash(password_hash)


def _verify_quietly(hasher: PasswordHasher, password_hash: str, password: str) -> bool:
    try:
        return hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: uuid.UUID, settings: Settings, now: datetime) -> str:
    claims = {
        "sub": str(user_id),
        "type": ACCESS_TOKEN_TYPE,
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.access_token_ttl_s)).timestamp()),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, settings: Settings, now: datetime | None = None) -> uuid.UUID:
    """Return the user id in a valid access token, or raise AuthError.

    `token_expired` tells the client to refresh; `invalid_token` means sign in again.
    """
    invalid = AuthError("invalid_token", "Access token is invalid")
    try:
        # Expiry is checked below against an explicit clock, so tests can pin `now`.
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            issuer=settings.jwt_issuer,
            options={
                "require": ["exp", "iat", "sub", "iss"],
                "verify_exp": False,
                "verify_iat": False,
            },
        )
    except jwt.PyJWTError as exc:
        raise invalid from exc
    if claims.get("type") != ACCESS_TOKEN_TYPE or not isinstance(claims["exp"], int):
        raise invalid
    if claims["exp"] <= (now or datetime.now(UTC)).timestamp():
        raise AuthError("token_expired", "Access token has expired")
    try:
        return uuid.UUID(claims["sub"])
    except ValueError as exc:
        raise invalid from exc


def new_refresh_token() -> tuple[str, str]:
    """Return (raw token for the client, SHA-256 hex digest for the database)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    # Refresh tokens are 384 random bits, so a fast unsalted hash is enough (no brute force).
    return hashlib.sha256(raw.encode()).hexdigest()
