from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import BodyWeight, UserProfile, UserSettings
from app.services import profile as profile_service
from tests.integration.helpers import bearer, register_user
from tests.oauth_helpers import RsaSigner, google_claims

pytestmark = pytest.mark.integration

Sessions = async_sessionmaker[AsyncSession]

ONBOARDING_ANSWERS: dict[str, Any] = {
    "sex": "female",
    "birth_date": "1995-03-01",
    "height_cm": 168.25,
    "weight_kg": 64.456,
    "activity_level": "moderate",
    "goal": "fat_loss",
    "experience": "beginner",
    "unit_weight": "lb",
    "unit_length": "in",
    "timezone": "Asia/Kolkata",
}


@pytest.fixture
async def auth(api_client: AsyncClient) -> dict[str, str]:
    return bearer(await register_user(api_client))


async def test_me_requires_auth(api_client: AsyncClient) -> None:
    for method, path in [
        ("GET", "/v1/me"),
        ("PATCH", "/v1/me/profile"),
        ("GET", "/v1/me/settings"),
    ]:
        response = await api_client.request(method, path, json={} if method == "PATCH" else None)
        assert response.status_code == 401, path


async def test_new_account_has_default_profile_and_settings(
    api_client: AsyncClient, auth: dict[str, str]
) -> None:
    response = await api_client.get("/v1/me", headers=auth)

    assert response.status_code == 200
    me = response.json()
    assert me["username"] == "lifter"
    assert me["onboarding_complete"] is False
    assert me["profile"] == {
        "sex": None,
        "birth_date": None,
        "height_cm": None,
        "weight_kg": None,
        "activity_level": None,
        "goal": None,
        "experience": None,
        "unit_weight": "kg",
        "unit_length": "cm",
        "water_goal_ml": None,
        "timezone": "UTC",
        "onboarding_completed_at": None,
    }
    assert me["settings"] == {
        "theme": "system",
        "default_rest_s": 90,
        "keep_awake": True,
        "show_burned_kcal": False,
        "water_cup_sizes": [250, 500, 750],
        "water_reminder_every_h": 2,
        "wake_time": "07:00:00",
        "sleep_time": "22:00:00",
        "reminders_enabled": False,
    }


async def test_onboarding_in_one_patch(api_client: AsyncClient, auth: dict[str, str]) -> None:
    response = await api_client.patch(
        "/v1/me/profile", headers=auth, json={**ONBOARDING_ANSWERS, "onboarding_complete": True}
    )

    assert response.status_code == 200, response.text
    profile = response.json()
    assert profile["height_cm"] == 168.3
    assert profile["weight_kg"] == 64.46
    assert profile["unit_weight"] == "lb"
    assert profile["timezone"] == "Asia/Kolkata"
    assert profile["onboarding_completed_at"] is not None

    me = (await api_client.get("/v1/me", headers=auth)).json()
    assert me["onboarding_complete"] is True
    assert me["profile"] == profile


async def test_onboarding_complete_lists_missing_answers(
    api_client: AsyncClient, auth: dict[str, str]
) -> None:
    response = await api_client.patch(
        "/v1/me/profile",
        headers=auth,
        json={"sex": "male", "goal": "muscle_gain", "onboarding_complete": True},
    )

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": "onboarding_incomplete",
        "message": "Answer every onboarding question first",
        "details": {
            "missing": ["birth_date", "height_cm", "weight_kg", "activity_level", "experience"]
        },
    }
    # Nothing from the rejected request was saved.
    me = (await api_client.get("/v1/me", headers=auth)).json()
    assert me["profile"]["sex"] is None


async def test_onboarding_across_several_patches(
    api_client: AsyncClient, auth: dict[str, str]
) -> None:
    for key, value in ONBOARDING_ANSWERS.items():
        response = await api_client.patch("/v1/me/profile", headers=auth, json={key: value})
        assert response.status_code == 200, key

    done = await api_client.patch(
        "/v1/me/profile", headers=auth, json={"onboarding_complete": True}
    )

    assert done.status_code == 200
    assert done.json()["weight_kg"] == 64.46


async def test_onboarding_completes_only_once(
    api_client: AsyncClient, auth: dict[str, str]
) -> None:
    first = await api_client.patch(
        "/v1/me/profile", headers=auth, json={**ONBOARDING_ANSWERS, "onboarding_complete": True}
    )
    again = await api_client.patch(
        "/v1/me/profile", headers=auth, json={"goal": "maintain", "onboarding_complete": True}
    )
    undo = await api_client.patch(
        "/v1/me/profile", headers=auth, json={"onboarding_complete": False}
    )

    stamp = first.json()["onboarding_completed_at"]
    assert again.json()["onboarding_completed_at"] == stamp
    assert undo.json()["onboarding_completed_at"] == stamp
    assert again.json()["goal"] == "maintain"


async def test_each_weight_patch_logs_a_weigh_in(
    api_client: AsyncClient, auth: dict[str, str], session_factory: Sessions
) -> None:
    await api_client.patch("/v1/me/profile", headers=auth, json={"weight_kg": 80})
    response = await api_client.patch("/v1/me/profile", headers=auth, json={"weight_kg": 79.5})

    assert response.json()["weight_kg"] == 79.5
    async with session_factory() as session:
        rows = (await session.execute(select(BodyWeight.weight_kg, BodyWeight.source))).all()
    assert sorted(rows) == [(79.5, "manual"), (80.0, "manual")]


async def test_soft_deleted_weights_are_ignored(
    api_client: AsyncClient, auth: dict[str, str], session_factory: Sessions
) -> None:
    await api_client.patch("/v1/me/profile", headers=auth, json={"weight_kg": 80})
    async with session_factory() as session:
        row = await session.scalar(select(BodyWeight))
        assert row is not None
        row.deleted_at = func.now()
        await session.commit()

    me = (await api_client.get("/v1/me", headers=auth)).json()

    assert me["profile"]["weight_kg"] is None


@pytest.mark.parametrize(
    ("payload", "loc"),
    [
        ({"birth_date": "2020-01-01"}, ["body", "birth_date"]),
        ({"timezone": "Mars/Base"}, ["body", "timezone"]),
        ({"height_cm": 20}, ["body", "height_cm"]),
        ({"sex": None}, ["body"]),
    ],
    ids=["too-young", "bad-timezone", "bad-height", "null-sex"],
)
async def test_profile_validation(
    api_client: AsyncClient, auth: dict[str, str], payload: dict[str, Any], loc: list[str]
) -> None:
    response = await api_client.patch("/v1/me/profile", headers=auth, json=payload)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["loc"] == loc


async def test_water_goal_can_be_set_and_cleared(
    api_client: AsyncClient, auth: dict[str, str]
) -> None:
    set_ = await api_client.patch("/v1/me/profile", headers=auth, json={"water_goal_ml": 3000})
    cleared = await api_client.patch("/v1/me/profile", headers=auth, json={"water_goal_ml": None})

    assert set_.json()["water_goal_ml"] == 3000
    assert cleared.json()["water_goal_ml"] is None


async def test_update_account_fields(api_client: AsyncClient, auth: dict[str, str]) -> None:
    response = await api_client.patch(
        "/v1/me",
        headers=auth,
        json={"username": "New_Name", "display_name": "  Iron Ann ", "is_private": True},
    )

    assert response.status_code == 200
    me = response.json()
    assert (me["username"], me["display_name"], me["is_private"]) == ("new_name", "Iron Ann", True)


async def test_keeping_your_own_username_is_fine(
    api_client: AsyncClient, auth: dict[str, str]
) -> None:
    response = await api_client.patch("/v1/me", headers=auth, json={"username": "LIFTER"})

    assert response.status_code == 200


async def test_username_taken(api_client: AsyncClient, auth: dict[str, str]) -> None:
    await register_user(api_client, email="other@example.com", username="taken")

    response = await api_client.patch("/v1/me", headers=auth, json={"username": "taken"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "username_taken"


async def test_cannot_promote_yourself_to_pro(
    api_client: AsyncClient, auth: dict[str, str]
) -> None:
    response = await api_client.patch("/v1/me", headers=auth, json={"is_pro": True})

    assert response.status_code == 422


async def test_settings_round_trip(api_client: AsyncClient, auth: dict[str, str]) -> None:
    response = await api_client.patch(
        "/v1/me/settings",
        headers=auth,
        json={
            "theme": "dark",
            "default_rest_s": 120,
            "keep_awake": False,
            "water_cup_sizes": [330, 200],
            "wake_time": "06:30",
            "reminders_enabled": True,
        },
    )

    assert response.status_code == 200, response.text
    fetched = (await api_client.get("/v1/me/settings", headers=auth)).json()
    assert fetched == response.json()
    assert fetched["theme"] == "dark"
    assert fetched["water_cup_sizes"] == [200, 330]
    assert fetched["wake_time"] == "06:30:00"
    assert fetched["sleep_time"] == "22:00:00"


@pytest.mark.parametrize(
    ("payload", "loc"),
    [
        ({"wake_time": "22:00"}, ["body", "wake_time"]),
        ({"sleep_time": "07:00"}, ["body", "sleep_time"]),
        ({"wake_time": "09:00", "sleep_time": "09:00"}, ["body", "wake_time"]),
    ],
)
async def test_wake_and_sleep_must_differ(
    api_client: AsyncClient, auth: dict[str, str], payload: dict[str, str], loc: list[str]
) -> None:
    response = await api_client.patch("/v1/me/settings", headers=auth, json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == loc


async def test_missing_rows_are_recreated(
    api_client: AsyncClient, auth: dict[str, str], session_factory: Sessions
) -> None:
    async with session_factory() as session:
        await session.execute(delete(UserProfile))
        await session.execute(delete(UserSettings))
        await session.commit()

    me = await api_client.get("/v1/me", headers=auth)
    settings = await api_client.get("/v1/me/settings", headers=auth)

    assert me.status_code == 200
    assert me.json()["profile"]["unit_weight"] == "kg"
    assert settings.json()["default_rest_s"] == 90


async def test_social_signup_also_gets_profile_rows(
    api_client: AsyncClient, session_factory: Sessions, oauth_signer: RsaSigner
) -> None:
    signed_in = await api_client.post(
        "/v1/auth/google", json={"id_token": oauth_signer.sign(google_claims())}
    )
    assert signed_in.status_code == 200

    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(UserProfile)) == 1
        assert await session.scalar(select(func.count()).select_from(UserSettings)) == 1


async def test_username_race_is_caught_by_the_unique_index(
    api_client: AsyncClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    await register_user(api_client, email="other@example.com", username="taken")

    async def looks_free(*_: object) -> bool:
        return True

    monkeypatch.setattr(profile_service, "username_available", looks_free)

    response = await api_client.patch("/v1/me", headers=auth, json={"username": "taken"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "username_taken"
