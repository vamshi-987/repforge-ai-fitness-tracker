import hashlib
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from redis.exceptions import ConnectionError as RedisConnectionError

from app.config import Settings
from app.core.errors import AppError
from app.services.oauth import APPLE, GOOGLE, fetch_jwks_http, verify_id_token
from tests.oauth_helpers import (
    APPLE_AUDIENCE,
    GOOGLE_AUDIENCE,
    FakeJwksFetcher,
    RsaSigner,
    apple_claims,
    google_claims,
)

SETTINGS = Settings(
    environment="test", google_client_ids=[GOOGLE_AUDIENCE], apple_client_ids=[APPLE_AUDIENCE]
)


@pytest.fixture(scope="module")
def signer() -> RsaSigner:
    return RsaSigner()


@pytest.fixture
def fetcher(signer: RsaSigner) -> FakeJwksFetcher:
    return FakeJwksFetcher(signer)


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis(decode_responses=True)
    yield client
    await client.aclose()


async def _verify_google(
    token: str, redis: FakeAsyncRedis, fetcher: FakeJwksFetcher, **kwargs: Any
) -> Any:
    settings = kwargs.pop("settings", SETTINGS)
    return await verify_id_token(
        GOOGLE, token, settings=settings, redis=redis, fetch=fetcher, **kwargs
    )


async def test_valid_google_token(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    identity = await _verify_google(signer.sign(google_claims()), redis, fetcher)

    assert identity.provider == "google"
    assert identity.subject == "google-sub-123"
    assert identity.email == "lifter@example.com"  # normalised
    assert identity.email_verified is True
    assert identity.name == "Gym Lifter"


async def test_jwks_is_cached_in_redis(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    await _verify_google(signer.sign(google_claims()), redis, fetcher)
    await _verify_google(signer.sign(google_claims()), redis, fetcher)

    assert fetcher.calls == 1
    assert json.loads(await redis.get("jwks:google") or "{}")["keys"][0]["kid"] == "test-key"
    assert 0 < await redis.ttl("jwks:google") <= SETTINGS.jwks_cache_ttl_s


async def test_rotated_key_triggers_one_refetch(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    await _verify_google(signer.sign(google_claims()), redis, fetcher)
    rotated = RsaSigner(kid="rotated-key")
    fetcher.keys.append(rotated.jwk())

    identity = await _verify_google(rotated.sign(google_claims()), redis, fetcher)

    assert identity.subject == "google-sub-123"
    assert fetcher.calls == 2


async def test_unknown_kid_refetch_has_a_cooldown(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    for _ in range(3):
        with pytest.raises(AppError) as exc:
            await _verify_google(signer.sign(google_claims(), kid="forged"), redis, fetcher)
        assert exc.value.code == "invalid_id_token"

    # One cache fill plus a single cooldown-limited refetch, not one per forged token.
    assert fetcher.calls == 2


@pytest.mark.parametrize(
    "claims",
    [
        google_claims(aud="someone-elses-client"),
        google_claims(iss="https://evil.example.com"),
        google_claims(exp=1_000),
        {k: v for k, v in google_claims().items() if k != "sub"},
    ],
    ids=["wrong-audience", "wrong-issuer", "expired", "no-sub"],
)
async def test_invalid_claims_are_rejected(
    claims: dict[str, Any], signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    with pytest.raises(AppError) as exc:
        await _verify_google(signer.sign(claims), redis, fetcher)

    assert exc.value.code == "invalid_id_token"
    assert exc.value.status_code == 401


async def test_token_signed_by_another_key_is_rejected(
    fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    impostor = RsaSigner(kid="test-key")  # same kid, different key

    with pytest.raises(AppError) as exc:
        await _verify_google(impostor.sign(google_claims()), redis, fetcher)

    assert exc.value.code == "invalid_id_token"


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        # HS256 header: the classic RS256 → HS256 key-confusion attack.
        "eyJhbGciOiJIUzI1NiIsImtpZCI6InRlc3Qta2V5In0.e30.sig",
        # RS256 header without a kid.
        "eyJhbGciOiJSUzI1NiJ9.e30.sig",
    ],
    ids=["garbage", "hs256", "no-kid"],
)
async def test_malformed_tokens_are_rejected(
    token: str, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    with pytest.raises(AppError) as exc:
        await _verify_google(token, redis, fetcher)

    assert exc.value.code == "invalid_id_token"
    assert fetcher.calls == 0


async def test_unconfigured_provider_returns_503(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    with pytest.raises(AppError) as exc:
        await _verify_google(
            signer.sign(google_claims()), redis, fetcher, settings=Settings(environment="test")
        )

    assert (exc.value.code, exc.value.status_code) == ("provider_not_configured", 503)


async def test_provider_outage_returns_503(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    fetcher.fail = True

    with pytest.raises(AppError) as exc:
        await _verify_google(signer.sign(google_claims()), redis, fetcher)

    assert (exc.value.code, exc.value.status_code) == ("provider_unavailable", 503)


class BrokenRedis(FakeAsyncRedis):
    async def get(self, *args: object, **kwargs: object) -> Any:
        raise RedisConnectionError("down")

    async def set(self, *args: object, **kwargs: object) -> Any:
        raise RedisConnectionError("down")


async def test_works_without_redis(signer: RsaSigner, fetcher: FakeJwksFetcher) -> None:
    identity = await _verify_google(signer.sign(google_claims()), BrokenRedis(), fetcher)

    assert identity.subject == "google-sub-123"


async def test_google_nonce_must_match(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    token = signer.sign(google_claims(nonce="n-123"))

    assert (await _verify_google(token, redis, fetcher, nonce="n-123")).subject
    with pytest.raises(AppError):
        await _verify_google(token, redis, fetcher, nonce="other")


async def test_apple_token_with_hashed_nonce_and_string_bool(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    hashed = hashlib.sha256(b"raw-nonce").hexdigest()
    token = signer.sign(apple_claims(nonce=hashed))

    identity = await verify_id_token(
        APPLE, token, settings=SETTINGS, redis=redis, fetch=fetcher, nonce="raw-nonce"
    )

    assert identity.provider == "apple"
    assert identity.subject == "apple-sub-456"
    assert identity.email_verified is True
    assert identity.name is None


async def test_unverified_or_missing_email(
    signer: RsaSigner, fetcher: FakeJwksFetcher, redis: FakeAsyncRedis
) -> None:
    token = signer.sign(google_claims(email_verified=False, email="  ", name=""))

    identity = await _verify_google(token, redis, fetcher)

    assert identity.email is None
    assert identity.email_verified is False
    assert identity.name is None


def _serve_jwks(monkeypatch: pytest.MonkeyPatch, payload: object) -> None:
    """Make fetch_jwks_http's httpx.AsyncClient answer every request with `payload`."""
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs)
    )


async def test_fetch_jwks_http_parses_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    _serve_jwks(monkeypatch, {"keys": [{"kid": "a"}]})

    assert await fetch_jwks_http("https://keys.example.com") == {"keys": [{"kid": "a"}]}


async def test_fetch_jwks_http_rejects_bad_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    _serve_jwks(monkeypatch, {"not": "keys"})

    with pytest.raises(ValueError):
        await fetch_jwks_http("https://keys.example.com")
