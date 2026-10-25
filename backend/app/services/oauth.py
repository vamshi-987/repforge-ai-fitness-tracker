"""Verify Google and Apple ID tokens against the provider's published keys (JWKS)."""

import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import jwt
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.config import Settings
from app.core.errors import AppError, AuthError

logger = logging.getLogger(__name__)

ProviderName = Literal["google", "apple"]
JwksFetcher = Callable[[str], Awaitable[dict[str, Any]]]

# An unknown `kid` usually means the provider rotated keys, so we refetch, but at most once
# per this many seconds; otherwise forged tokens with random kids could hammer the provider.
JWKS_REFETCH_COOLDOWN_S = 60
CLOCK_SKEW_S = 60


@dataclass(frozen=True)
class Provider:
    name: ProviderName
    jwks_url: str
    issuers: tuple[str, ...]
    # Apple puts SHA-256(nonce) in the token; Google puts the nonce itself.
    hashed_nonce: bool


GOOGLE = Provider(
    name="google",
    jwks_url="https://www.googleapis.com/oauth2/v3/certs",
    issuers=("https://accounts.google.com", "accounts.google.com"),
    hashed_nonce=False,
)
APPLE = Provider(
    name="apple",
    jwks_url="https://appleid.apple.com/auth/keys",
    issuers=("https://appleid.apple.com",),
    hashed_nonce=True,
)


@dataclass(frozen=True)
class OAuthIdentity:
    provider: ProviderName
    subject: str
    email: str | None
    email_verified: bool
    name: str | None


async def fetch_jwks_http(url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()
    if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
        raise ValueError("JWKS response has no 'keys' list")
    return data


def audiences_for(provider: Provider, settings: Settings) -> list[str]:
    return settings.google_client_ids if provider.name == "google" else settings.apple_client_ids


def _invalid() -> AuthError:
    return AuthError("invalid_id_token", "Sign-in token is invalid")


async def _load_jwks(
    provider: Provider, redis: Redis, fetch: JwksFetcher, ttl_s: int, *, refresh: bool
) -> dict[str, Any] | None:
    """Return the provider's JWKS from Redis, or fetch and cache it.

    With `refresh=True` the cache is bypassed, unless a refresh ran within the cooldown, in
    which case None is returned.
    """
    cache_key = f"jwks:{provider.name}"
    try:
        if not refresh:
            cached = await redis.get(cache_key)
            if cached:
                loaded: dict[str, Any] = json.loads(cached)
                return loaded
        elif not await redis.set(f"{cache_key}:refetch", "1", nx=True, ex=JWKS_REFETCH_COOLDOWN_S):
            return None
    except RedisError as exc:
        logger.warning("jwks_cache_unavailable", extra={"error": repr(exc)})

    try:
        jwks = await fetch(provider.jwks_url)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("jwks_fetch_failed", extra={"provider": provider.name, "error": repr(exc)})
        raise AppError(
            "provider_unavailable", "Sign-in provider is unavailable, try again", 503
        ) from exc

    try:
        await redis.set(cache_key, json.dumps(jwks), ex=ttl_s)
    except RedisError as exc:
        logger.warning("jwks_cache_unavailable", extra={"error": repr(exc)})
    return jwks


def _find_key(jwks: dict[str, Any] | None, kid: str) -> dict[str, Any] | None:
    if jwks is None:
        return None
    for key in jwks.get("keys", []):
        if isinstance(key, dict) and key.get("kid") == kid:
            return key
    return None


def _is_true(value: object) -> bool:
    # Apple sends email_verified as the string "true"; Google sends a boolean.
    return value is True or value == "true"


async def verify_id_token(
    provider: Provider,
    id_token: str,
    *,
    settings: Settings,
    redis: Redis,
    fetch: JwksFetcher,
    nonce: str | None = None,
) -> OAuthIdentity:
    audiences = audiences_for(provider, settings)
    if not audiences:
        raise AppError(
            "provider_not_configured", f"{provider.name.title()} sign-in is not configured", 503
        )

    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as exc:
        raise _invalid() from exc
    kid = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(kid, str):
        raise _invalid()

    ttl_s = settings.jwks_cache_ttl_s
    jwk = _find_key(await _load_jwks(provider, redis, fetch, ttl_s, refresh=False), kid)
    if jwk is None:
        jwk = _find_key(await _load_jwks(provider, redis, fetch, ttl_s, refresh=True), kid)
    if jwk is None:
        raise _invalid()

    try:
        claims = jwt.decode(
            id_token,
            jwt.PyJWK(jwk, algorithm="RS256").key,
            algorithms=["RS256"],
            audience=audiences,
            issuer=list(provider.issuers),
            leeway=CLOCK_SKEW_S,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise _invalid() from exc

    if nonce is not None:
        expected = hashlib.sha256(nonce.encode()).hexdigest() if provider.hashed_nonce else nonce
        if claims.get("nonce") != expected:
            raise _invalid()

    email = claims.get("email")
    name = claims.get("name")
    return OAuthIdentity(
        provider=provider.name,
        subject=str(claims["sub"]),
        email=email.strip().lower() if isinstance(email, str) and email.strip() else None,
        email_verified=_is_true(claims.get("email_verified")),
        name=name if isinstance(name, str) and name.strip() else None,
    )
