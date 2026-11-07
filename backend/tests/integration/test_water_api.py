import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient

from app.services.library_seed import library_id
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Headers = dict[str, str]
BENCH = str(library_id("exercise", "bench-press-barbell"))


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    headers = bearer(await register_user(api_client))
    await api_client.post(
        "/v1/body/weights",
        headers=headers,
        json={"measured_at": ago(days=1), "weight_kg": 80},
    )
    return headers


def ago(**delta: float) -> str:
    return (datetime.now(UTC) - timedelta(**delta)).isoformat()


async def drink(client: AsyncClient, auth: Headers, ml: int, **extra: Any) -> dict[str, Any]:
    response = await client.post("/v1/water", headers=auth, json={"amount_ml": ml, **extra})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def today(client: AsyncClient, auth: Headers) -> dict[str, Any]:
    response = await client.get("/v1/water", headers=auth)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


@pytest.mark.parametrize(
    ("method", "path"),
    [("POST", "/v1/water"), ("GET", "/v1/water"), ("GET", "/v1/water/history")],
)
async def test_water_requires_auth(api_client: AsyncClient, method: str, path: str) -> None:
    assert (await api_client.request(method, path)).status_code == 401


async def test_today_adds_up_against_the_goal(api_client: AsyncClient, auth: Headers) -> None:
    first = await drink(api_client, auth, 250)
    await drink(api_client, auth, 500)

    day = await today(api_client, auth)

    assert day["date"] == datetime.now(UTC).date().isoformat()
    assert (day["goal_ml"], day["total_ml"], day["trained"]) == (2800, 750, False)
    assert [log["amount_ml"] for log in day["logs"]] == [250, 500]
    assert first["version"] == 1


async def test_a_workout_raises_the_goal(api_client: AsyncClient, auth: Headers) -> None:
    end = datetime.now(UTC) - timedelta(minutes=5)
    await api_client.put(
        f"/v1/workouts/{uuid.uuid4()}",
        headers=auth,
        json={
            "title": "Push",
            "started_at": (end - timedelta(minutes=30)).isoformat(),
            "ended_at": end.isoformat(),
            "exercises": [{"exercise_id": BENCH, "sets": [{"weight_kg": 60, "reps": 8}]}],
        },
    )

    day = await today(api_client, auth)

    assert (day["goal_ml"], day["trained"]) == (3300, True)


async def test_a_custom_goal_replaces_the_base(api_client: AsyncClient, auth: Headers) -> None:
    await api_client.patch("/v1/me/profile", headers=auth, json={"water_goal_ml": 2000})

    assert (await today(api_client, auth))["goal_ml"] == 2000


async def test_days_follow_the_users_timezone(api_client: AsyncClient, auth: Headers) -> None:
    await api_client.patch("/v1/me/profile", headers=auth, json={"timezone": "Asia/Kolkata"})
    # 20:00 UTC on 29 October is 01:30 on 30 October in India.
    await drink(api_client, auth, 300, logged_at="2026-10-29T20:00:00Z")
    await drink(api_client, auth, 400, logged_at="2026-10-29T10:00:00Z")

    oct30 = (await api_client.get("/v1/water?date=2026-10-30", headers=auth)).json()
    oct29 = (await api_client.get("/v1/water?date=2026-10-29", headers=auth)).json()
    bad = await api_client.get("/v1/water?date=yesterday", headers=auth)

    assert oct30["total_ml"] == 300
    assert oct29["total_ml"] == 400
    assert bad.status_code == 422


async def test_delete_and_validation(api_client: AsyncClient, auth: Headers) -> None:
    log_id = str(uuid.uuid4())
    await drink(api_client, auth, 250, id=log_id)

    taken = await api_client.post("/v1/water", headers=auth, json={"id": log_id, "amount_ml": 1})
    too_much = await api_client.post("/v1/water", headers=auth, json={"amount_ml": 9000})
    future = await api_client.post(
        "/v1/water", headers=auth, json={"amount_ml": 250, "logged_at": ago(hours=-1)}
    )
    other = bearer(await register_user(api_client, email="other@example.com"))
    theirs = await api_client.delete(f"/v1/water/{log_id}", headers=other)
    removed = await api_client.delete(f"/v1/water/{log_id}", headers=auth)
    again = await api_client.delete(f"/v1/water/{log_id}", headers=auth)

    assert taken.status_code == 409
    assert too_much.status_code == 422
    assert future.status_code == 422
    assert theirs.status_code == 404
    assert removed.status_code == 204
    assert again.status_code == 404
    assert (await today(api_client, auth))["total_ml"] == 0


async def test_history_has_every_day(api_client: AsyncClient, auth: Headers) -> None:
    await drink(api_client, auth, 1000, logged_at=ago(days=3))
    await drink(api_client, auth, 500)

    month = (await api_client.get("/v1/water/history?range=1m", headers=auth)).json()["days"]
    everything = (await api_client.get("/v1/water/history?range=all", headers=auth)).json()["days"]

    assert len(month) in (30, 31)
    assert month[-1]["date"] == datetime.now(UTC).date().isoformat()
    assert month[-1]["total_ml"] == 500
    assert sum(d["total_ml"] for d in month) == 1500
    assert all(d["goal_ml"] == 2800 for d in month)
    assert date.fromisoformat(everything[0]["date"]) == datetime.now(UTC).date() - timedelta(days=3)


async def test_an_empty_all_time_history_is_today(api_client: AsyncClient, auth: Headers) -> None:
    days = (await api_client.get("/v1/water/history?range=all", headers=auth)).json()["days"]

    assert [d["total_ml"] for d in days] == [0]


async def test_water_syncs(api_client: AsyncClient, auth: Headers) -> None:
    log_id = str(uuid.uuid4())

    async def push(change: dict[str, Any]) -> dict[str, Any]:
        response = await api_client.post("/v1/sync/push", headers=auth, json={"changes": [change]})
        result: dict[str, Any] = response.json()["results"][0]
        return result

    created = await push(
        {"entity": "water_log", "id": log_id, "op": "upsert", "data": {"amount_ml": 250}}
    )
    edited = await push(
        {
            "entity": "water_log",
            "id": log_id,
            "op": "upsert",
            "data": {"amount_ml": 330, "logged_at": created["data"]["logged_at"]},
        }
    )
    pulled = (await api_client.get("/v1/sync/pull", headers=auth)).json()["changes"]
    deleted = await push({"entity": "water_log", "id": log_id, "op": "delete"})

    assert created["status"] == "applied"
    assert (edited["data"]["amount_ml"], edited["data"]["version"]) == (330, 2)
    assert ("water_log", log_id) in {(c["entity"], c["id"]) for c in pulled}
    assert deleted["status"] == "applied"
