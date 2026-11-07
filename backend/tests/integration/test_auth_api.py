import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.core.errors import AppError
from app.db.models import AuthProvider, RefreshToken, User
from app.deps import CurrentUser
from app.services import auth as auth_service
from app.services.security import create_access_token
from tests.integration.helpers import TEST_PASSWORD, bearer, register_user
from tests.oauth_helpers import FakeJwksFetcher, RsaSigner, apple_claims, google_claims

pytestmark = pytest.mark.integration

Sessions = async_sessionmaker[AsyncSession]


@pytest.fixture(autouse=True)
def whoami_route(app: FastAPI) -> None:
    """A protected route, so these tests exercise CurrentUser before /me exists."""

    @app.get("/_test/whoami")
    async def whoami(user: CurrentUser) -> dict[str, str]:
        return {"id": str(user.id), "username": user.username}


async def _tokens_in_family(sessions: Sessions, family_id: uuid.UUID) -> list[RefreshToken]:
    async with sessions() as session:
        result = await session.scalars(
            select(RefreshToken).where(RefreshToken.family_id == family_id)
        )
        return list(result)


async def _family_of(sessions: Sessions, user_id: str) -> uuid.UUID:
    async with sessions() as session:
        family = await session.scalar(
            select(RefreshToken.family_id).where(RefreshToken.user_id == uuid.UUID(user_id))
        )
    assert family is not None
    return family


# --- register ---------------------------------------------------------------------------


async def test_register_returns_tokens_and_user(api_client: AsyncClient) -> None:
    body = await register_user(api_client, email="  New.Lifter@Example.com ")

    user = body["user"]
    assert user["email"] == "new.lifter@example.com"
    assert user["username"] == "newlifter"
    assert user["display_name"] == "newlifter"
    assert user["auth_provider"] == "password"
    assert user["is_pro"] is False
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 900
    assert body["refresh_expires_in"] == 30 * 24 * 3600
    assert body["is_new_user"] is True

    me = await api_client.get("/_test/whoami", headers=bearer(body))
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]


async def test_register_with_username_and_display_name(api_client: AsyncClient) -> None:
    body = await register_user(api_client, username="Iron_Ann", display_name="  Ann  ")

    assert body["user"]["username"] == "iron_ann"
    assert body["user"]["display_name"] == "Ann"


async def test_password_is_stored_as_argon2(
    api_client: AsyncClient, session_factory: Sessions
) -> None:
    await register_user(api_client)

    async with session_factory() as session:
        stored = await session.scalar(select(User.password_hash))
    assert stored is not None
    assert stored.startswith("$argon2id$")
    assert TEST_PASSWORD not in stored


async def test_generated_usernames_stay_unique(api_client: AsyncClient) -> None:
    first = await register_user(api_client, email="sam@example.com")
    second = await register_user(api_client, email="sam@other.example.com")

    assert first["user"]["username"] == "sam"
    assert second["user"]["username"].startswith("sam")
    assert second["user"]["username"] != "sam"


async def test_duplicate_email_is_409(api_client: AsyncClient) -> None:
    await register_user(api_client)

    response = await api_client.post(
        "/v1/auth/register", json={"email": "LIFTER@example.com", "password": TEST_PASSWORD}
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "email_taken"


async def test_duplicate_username_is_409(api_client: AsyncClient) -> None:
    await register_user(api_client, username="taken")

    response = await api_client.post(
        "/v1/auth/register",
        json={"email": "other@example.com", "password": TEST_PASSWORD, "username": "TAKEN"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "username_taken"


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email", "password": TEST_PASSWORD},
        {"email": "a@example.com", "password": "short"},
        {"email": "a@example.com", "password": "x" * 129},
        {"email": "a@example.com", "password": TEST_PASSWORD, "username": "no spaces"},
    ],
    ids=["bad-email", "short-password", "huge-password", "bad-username"],
)
async def test_register_validation(api_client: AsyncClient, payload: dict[str, str]) -> None:
    response = await api_client.post("/v1/auth/register", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


# --- login ------------------------------------------------------------------------------


async def test_login_is_case_insensitive_on_email(api_client: AsyncClient) -> None:
    await register_user(api_client)

    response = await api_client.post(
        "/v1/auth/login", json={"email": "Lifter@EXAMPLE.com", "password": TEST_PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "lifter@example.com"
    assert response.json()["is_new_user"] is False


@pytest.mark.parametrize(
    ("email", "password"),
    [("lifter@example.com", "wrong-password"), ("nobody@example.com", TEST_PASSWORD)],
    ids=["wrong-password", "unknown-email"],
)
async def test_login_failures_look_identical(
    api_client: AsyncClient, email: str, password: str
) -> None:
    await register_user(api_client)

    response = await api_client.post("/v1/auth/login", json={"email": email, "password": password})

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"] == {
        "code": "invalid_credentials",
        "message": "Email or password is incorrect",
        "details": None,
    }


async def test_login_is_rate_limited_per_ip(
    api_client: AsyncClient, test_settings: Settings
) -> None:
    test_settings.login_rate_limit = 3
    payload = {"email": "nobody@example.com", "password": "wrong-password"}

    statuses = [
        (await api_client.post("/v1/auth/login", json=payload)).status_code for _ in range(4)
    ]

    assert statuses == [401, 401, 401, 429]
    blocked = await api_client.post("/v1/auth/login", json=payload)
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert 0 < int(blocked.headers["retry-after"]) <= test_settings.login_rate_window_s


async def test_login_rehashes_outdated_hashes(
    api_client: AsyncClient, session_factory: Sessions
) -> None:
    from argon2 import PasswordHasher

    await register_user(api_client)
    old_hash = PasswordHasher(time_cost=1, memory_cost=512, parallelism=1).hash(TEST_PASSWORD)
    async with session_factory() as session:
        await session.execute(update(User).values(password_hash=old_hash))
        await session.commit()

    response = await api_client.post(
        "/v1/auth/login", json={"email": "lifter@example.com", "password": TEST_PASSWORD}
    )

    assert response.status_code == 200
    async with session_factory() as session:
        assert await session.scalar(select(User.password_hash)) != old_hash


# --- access tokens ----------------------------------------------------------------------


async def test_protected_route_requires_a_token(api_client: AsyncClient) -> None:
    response = await api_client.get("/_test/whoami")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


async def test_expired_access_token_says_token_expired(
    api_client: AsyncClient, test_settings: Settings
) -> None:
    body = await register_user(api_client)
    user_id = uuid.UUID(body["user"]["id"])
    stale = create_access_token(user_id, test_settings, datetime.now(UTC) - timedelta(hours=1))

    response = await api_client.get("/_test/whoami", headers={"Authorization": f"Bearer {stale}"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "token_expired"


async def test_token_for_deleted_user_is_rejected(
    api_client: AsyncClient, session_factory: Sessions
) -> None:
    body = await register_user(api_client)
    async with session_factory() as session:
        await session.execute(update(User).values(deleted_at=datetime.now(UTC)))
        await session.commit()

    response = await api_client.get("/_test/whoami", headers=bearer(body))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


# --- refresh rotation -------------------------------------------------------------------


async def test_refresh_rotates_the_token(
    api_client: AsyncClient, session_factory: Sessions
) -> None:
    body = await register_user(api_client)

    response = await api_client.post(
        "/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )

    assert response.status_code == 200
    rotated = response.json()
    assert rotated["refresh_token"] != body["refresh_token"]
    assert (await api_client.get("/_test/whoami", headers=bearer(rotated))).status_code == 200

    family = await _tokens_in_family(
        session_factory, await _family_of(session_factory, body["user"]["id"])
    )
    assert len(family) == 2
    # now() is fixed within the test's single transaction, so tell them apart by linkage.
    (first,) = [token for token in family if token.replaced_by is not None]
    (second,) = [token for token in family if token is not first]
    assert first.revoked_at is not None
    assert first.replaced_by == second.id
    assert second.revoked_at is None


async def test_refresh_token_reuse_revokes_the_whole_family(
    api_client: AsyncClient, session_factory: Sessions
) -> None:
    """Phase 1 'done when': replaying a rotated refresh token kills every token in its family."""
    body = await register_user(api_client)
    stolen = body["refresh_token"]
    legit = (await api_client.post("/v1/auth/refresh", json={"refresh_token": stolen})).json()

    # An attacker replays the old token: rejected, and the family is revoked.
    replay = await api_client.post("/v1/auth/refresh", json={"refresh_token": stolen})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "refresh_token_reused"

    # The legitimate user's newer token is dead too, so both must sign in again.
    after = await api_client.post(
        "/v1/auth/refresh", json={"refresh_token": legit["refresh_token"]}
    )
    assert after.status_code == 401
    assert after.json()["error"]["code"] == "refresh_token_reused"

    family = await _tokens_in_family(
        session_factory, await _family_of(session_factory, body["user"]["id"])
    )
    assert len(family) == 2
    assert all(token.revoked_at is not None for token in family)


async def test_reuse_does_not_touch_other_sessions(api_client: AsyncClient) -> None:
    phone = await register_user(api_client)
    tablet = (
        await api_client.post(
            "/v1/auth/login", json={"email": "lifter@example.com", "password": TEST_PASSWORD}
        )
    ).json()
    await api_client.post("/v1/auth/refresh", json={"refresh_token": phone["refresh_token"]})
    await api_client.post("/v1/auth/refresh", json={"refresh_token": phone["refresh_token"]})

    response = await api_client.post(
        "/v1/auth/refresh", json={"refresh_token": tablet["refresh_token"]}
    )

    assert response.status_code == 200


async def test_expired_refresh_token(api_client: AsyncClient, session_factory: Sessions) -> None:
    body = await register_user(api_client)
    async with session_factory() as session:
        await session.execute(
            update(RefreshToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()

    response = await api_client.post(
        "/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "refresh_token_expired"


async def test_unknown_refresh_token(api_client: AsyncClient) -> None:
    response = await api_client.post("/v1/auth/refresh", json={"refresh_token": "x" * 64})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_refresh_token"


async def test_refresh_for_deleted_user(api_client: AsyncClient, session_factory: Sessions) -> None:
    body = await register_user(api_client)
    async with session_factory() as session:
        await session.execute(update(User).values(deleted_at=datetime.now(UTC)))
        await session.commit()

    response = await api_client.post(
        "/v1/auth/refresh", json={"refresh_token": body["refresh_token"]}
    )

    assert response.json()["error"]["code"] == "invalid_refresh_token"


# --- logout -----------------------------------------------------------------------------


async def test_logout_revokes_the_session(api_client: AsyncClient) -> None:
    body = await register_user(api_client)

    response = await api_client.post(
        "/v1/auth/logout", json={"refresh_token": body["refresh_token"]}
    )

    assert response.status_code == 204
    assert response.content == b""
    after = await api_client.post("/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert after.status_code == 401


async def test_logout_with_unknown_token_is_a_no_op(api_client: AsyncClient) -> None:
    response = await api_client.post("/v1/auth/logout", json={"refresh_token": "y" * 64})

    assert response.status_code == 204


# --- Google / Apple ---------------------------------------------------------------------


async def test_google_sign_in_creates_then_reuses_the_account(
    api_client: AsyncClient, oauth_signer: RsaSigner
) -> None:
    token = oauth_signer.sign(google_claims())

    first = await api_client.post("/v1/auth/google", json={"id_token": token})
    second = await api_client.post("/v1/auth/google", json={"id_token": token})

    assert first.status_code == 200, first.text
    assert first.json()["is_new_user"] is True
    assert first.json()["user"]["auth_provider"] == "google"
    assert first.json()["user"]["email"] == "lifter@example.com"
    assert first.json()["user"]["display_name"] == "Gym Lifter"
    assert second.json()["is_new_user"] is False
    assert second.json()["user"]["id"] == first.json()["user"]["id"]


async def test_google_links_to_existing_password_account(
    api_client: AsyncClient, oauth_signer: RsaSigner, session_factory: Sessions
) -> None:
    registered = await register_user(api_client)

    response = await api_client.post(
        "/v1/auth/google", json={"id_token": oauth_signer.sign(google_claims())}
    )

    assert response.status_code == 200
    assert response.json()["user"]["id"] == registered["user"]["id"]
    assert response.json()["is_new_user"] is False
    async with session_factory() as session:
        assert await session.scalar(select(User.google_sub)) == "google-sub-123"
    # The password still works after linking.
    login = await api_client.post(
        "/v1/auth/login", json={"email": "lifter@example.com", "password": TEST_PASSWORD}
    )
    assert login.status_code == 200


async def test_social_only_account_cannot_password_login(
    api_client: AsyncClient, oauth_signer: RsaSigner
) -> None:
    await api_client.post("/v1/auth/google", json={"id_token": oauth_signer.sign(google_claims())})

    response = await api_client.post(
        "/v1/auth/login", json={"email": "lifter@example.com", "password": TEST_PASSWORD}
    )

    assert response.json()["error"]["code"] == "invalid_credentials"


async def test_google_without_verified_email_is_422(
    api_client: AsyncClient, oauth_signer: RsaSigner
) -> None:
    token = oauth_signer.sign(google_claims(email_verified=False))

    response = await api_client.post("/v1/auth/google", json={"id_token": token})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "email_required"


async def test_apple_sign_in_uses_given_display_name_then_sub_without_email(
    api_client: AsyncClient, oauth_signer: RsaSigner
) -> None:
    first = await api_client.post(
        "/v1/auth/apple",
        json={"id_token": oauth_signer.sign(apple_claims()), "display_name": "Ann Apple"},
    )
    # Later Apple tokens may omit the email; the subject alone identifies the user.
    no_email = {k: v for k, v in apple_claims().items() if k not in ("email", "email_verified")}
    second = await api_client.post("/v1/auth/apple", json={"id_token": oauth_signer.sign(no_email)})

    assert first.status_code == 200, first.text
    assert first.json()["user"]["display_name"] == "Ann Apple"
    assert first.json()["user"]["auth_provider"] == "apple"
    assert second.status_code == 200
    assert second.json()["user"]["id"] == first.json()["user"]["id"]


async def test_apple_links_to_existing_password_account(
    api_client: AsyncClient, oauth_signer: RsaSigner, session_factory: Sessions
) -> None:
    registered = await register_user(api_client, email="relay@privaterelay.appleid.com")

    response = await api_client.post(
        "/v1/auth/apple", json={"id_token": oauth_signer.sign(apple_claims())}
    )

    assert response.json()["user"]["id"] == registered["user"]["id"]
    async with session_factory() as session:
        assert await session.scalar(select(User.apple_sub)) == "apple-sub-456"


@pytest.mark.parametrize(
    ("email", "username", "code"),
    [
        ("lifter@example.com", "fresh_name", "email_taken"),
        ("fresh@example.com", "taken", "username_taken"),
    ],
)
async def test_create_user_race_becomes_409(
    api_client: AsyncClient, session_factory: Sessions, email: str, username: str, code: str
) -> None:
    """Two signups racing past the pre-checks: the unique index decides, as a 409."""
    await register_user(api_client, username="taken")

    async with session_factory() as session:
        with pytest.raises(AppError) as exc:
            await auth_service.create_user(
                session, email=email, provider=AuthProvider.PASSWORD, username=username
            )

    assert (exc.value.code, exc.value.status_code) == (code, 409)


async def test_social_sign_in_to_deleted_account(
    api_client: AsyncClient, oauth_signer: RsaSigner, session_factory: Sessions
) -> None:
    token = oauth_signer.sign(google_claims())
    await api_client.post("/v1/auth/google", json={"id_token": token})
    async with session_factory() as session:
        await session.execute(update(User).values(deleted_at=datetime.now(UTC)))
        await session.commit()

    response = await api_client.post("/v1/auth/google", json={"id_token": token})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "account_deleted"


async def test_invalid_google_token_is_401(api_client: AsyncClient) -> None:
    forged = RsaSigner(kid="test-key").sign(google_claims())

    response = await api_client.post("/v1/auth/google", json={"id_token": forged})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_id_token"


async def test_unconfigured_provider_is_503(
    api_client: AsyncClient, oauth_signer: RsaSigner, test_settings: Settings
) -> None:
    test_settings.apple_client_ids = []

    response = await api_client.post(
        "/v1/auth/apple", json={"id_token": oauth_signer.sign(apple_claims())}
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_not_configured"


async def test_jwks_is_fetched_once_across_requests(
    api_client: AsyncClient, oauth_signer: RsaSigner, jwks_fetcher: FakeJwksFetcher
) -> None:
    for _ in range(3):
        await api_client.post(
            "/v1/auth/google", json={"id_token": oauth_signer.sign(google_claims())}
        )

    assert jwks_fetcher.calls == 1
