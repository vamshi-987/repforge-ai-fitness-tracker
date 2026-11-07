import re
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError

from app.config import DEV_JWT_SECRET, Settings
from app.schemas.user import Username
from app.services import auth as auth_service
from app.services.auth import classify_refresh, conflict_from, normalize_email, username_base

NOW = datetime(2026, 10, 25, tzinfo=UTC)


def test_normalize_email() -> None:
    assert normalize_email("  Lifter@Example.COM ") == "lifter@example.com"


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("john.doe+gym@example.com", "johndoegym"),
        ("ab@example.com", "ablifter"),
        ("a-very-long-local-part-indeed@example.com", "averylonglocalpartin"),
        ("Ünïcode@example.com", "ncode"),
    ],
)
def test_username_base(email: str, expected: str) -> None:
    base = username_base(email)

    assert base == expected
    TypeAdapter(Username).validate_python(base)


@pytest.mark.parametrize(
    ("revoked_at", "expires_at", "state"),
    [
        (None, NOW + timedelta(days=1), "ok"),
        (None, NOW, "expired"),
        (NOW - timedelta(hours=1), NOW + timedelta(days=1), "reused"),
        # A revoked token is a reuse even after expiry: still a sign of theft.
        (NOW - timedelta(days=40), NOW - timedelta(days=10), "reused"),
    ],
)
def test_classify_refresh(revoked_at: datetime | None, expires_at: datetime, state: str) -> None:
    assert classify_refresh(revoked_at, expires_at, NOW) == state


@pytest.mark.parametrize("value", ["lifter_99", "Big.Lifter", "abc", "a" * 30])
def test_valid_usernames(value: str) -> None:
    assert TypeAdapter(Username).validate_python(value) == value.lower()


@pytest.mark.parametrize(
    "value", ["ab", "a" * 31, ".lifter", "lifter.", "li..fter", "lift er", "léo"]
)
def test_invalid_usernames(value: str) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(Username).validate_python(value)


def test_prod_refuses_the_dev_jwt_secret() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(environment="prod", jwt_secret=DEV_JWT_SECRET)
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(environment="prod", jwt_secret="short")

    assert Settings(environment="prod", jwt_secret="x" * 32).environment == "prod"


@pytest.mark.parametrize(
    ("constraint", "code"),
    [
        ("uq_users_email", "email_taken"),
        ("uq_users_username", "username_taken"),
        ("uq_users_google_sub", "conflict"),
    ],
)
def test_integrity_errors_map_to_409(constraint: str, code: str) -> None:
    exc = IntegrityError("INSERT ...", {}, Exception(f'violates "{constraint}"'))

    error = conflict_from(exc)

    assert (error.code, error.status_code) == (code, 409)


async def test_username_falls_back_to_random_suffix(monkeypatch: pytest.MonkeyPatch) -> None:
    async def never_available(*_: object) -> bool:
        return False

    monkeypatch.setattr(auth_service, "username_available", never_available)

    username = await auth_service._pick_username(None, "sam@example.com")  # type: ignore[arg-type]

    assert re.fullmatch(r"sam[0-9a-f]{8}", username)
