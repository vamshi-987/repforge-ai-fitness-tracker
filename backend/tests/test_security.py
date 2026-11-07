import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import Settings
from app.core.errors import AuthError
from app.services.security import (
    JWT_ALGORITHM,
    create_access_token,
    decode_access_token,
    hash_password,
    hash_refresh_token,
    hasher_for,
    new_refresh_token,
    password_hasher,
    verify_password,
)

SETTINGS = Settings(environment="test", jwt_secret="unit-test-secret-that-is-long-enough")
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)


async def test_hash_and_verify_password() -> None:
    hasher = hasher_for(SETTINGS)
    stored = await hash_password("correct horse", hasher)

    assert stored.startswith("$argon2id$")
    assert await verify_password("correct horse", stored, hasher) == (True, False)
    assert await verify_password("wrong horse", stored, hasher) == (False, False)


async def test_verify_without_hash_is_false() -> None:
    assert await verify_password("anything", None, hasher_for(SETTINGS)) == (False, False)


async def test_verify_with_garbage_hash_is_false() -> None:
    assert await verify_password("pw", "not-a-hash", hasher_for(SETTINGS)) == (False, False)


async def test_weaker_hash_is_flagged_for_rehash() -> None:
    weak = await hash_password("correct horse", password_hasher(fast=True))

    matches, needs_rehash = await verify_password("correct horse", weak, password_hasher())

    assert matches and needs_rehash


def test_test_environment_uses_fast_hasher() -> None:
    assert hasher_for(SETTINGS) is password_hasher(fast=True)
    assert hasher_for(Settings(environment="dev")) is password_hasher(fast=False)


def test_access_token_round_trip() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id, SETTINGS, NOW)

    assert decode_access_token(token, SETTINGS, now=NOW + timedelta(minutes=14)) == user_id


def test_access_token_expires_after_ttl() -> None:
    token = create_access_token(uuid.uuid4(), SETTINGS, NOW)

    with pytest.raises(AuthError) as exc:
        decode_access_token(token, SETTINGS, now=NOW + timedelta(minutes=15))

    assert exc.value.code == "token_expired"
    assert exc.value.status_code == 401
    assert exc.value.headers == {"WWW-Authenticate": "Bearer"}


def _signed(claims: dict[str, object], secret: str = SETTINGS.jwt_secret) -> str:
    return jwt.encode(claims, secret, algorithm=JWT_ALGORITHM)


def _claims(**overrides: object) -> dict[str, object]:
    claims: dict[str, object] = {
        "sub": str(uuid.uuid4()),
        "type": "access",
        "iss": SETTINGS.jwt_issuer,
        "iat": int(NOW.timestamp()),
        "exp": int(NOW.timestamp()) + 900,
    }
    claims.update(overrides)
    return claims


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt",
        _signed(_claims(), secret="some-other-secret-of-sufficient-length"),
        _signed(_claims(iss="someone-else")),
        _signed(_claims(type="refresh")),
        _signed(_claims(sub="not-a-uuid")),
        _signed(_claims(exp="soon")),
        _signed({k: v for k, v in _claims().items() if k != "sub"}),
    ],
    ids=["garbage", "bad-signature", "bad-issuer", "wrong-type", "bad-sub", "bad-exp", "no-sub"],
)
def test_invalid_access_tokens_are_rejected(token: str) -> None:
    with pytest.raises(AuthError) as exc:
        decode_access_token(token, SETTINGS, now=NOW)

    assert exc.value.code == "invalid_token"


def test_alg_none_is_rejected() -> None:
    token = jwt.encode(_claims(), key="", algorithm="none")

    with pytest.raises(AuthError):
        decode_access_token(token, SETTINGS, now=NOW)


def test_refresh_tokens_are_random_and_stored_hashed() -> None:
    raw_a, hash_a = new_refresh_token()
    raw_b, _ = new_refresh_token()

    assert raw_a != raw_b
    assert len(raw_a) >= 64
    assert hash_a == hash_refresh_token(raw_a)
    assert len(hash_a) == 64
    assert raw_a not in hash_a
