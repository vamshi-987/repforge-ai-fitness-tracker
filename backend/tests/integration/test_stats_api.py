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
SQUAT = str(library_id("exercise", "squat-barbell"))


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client))


async def log(
    client: AsyncClient,
    auth: Headers,
    end: datetime,
    exercise: str = BENCH,
    sets: int = 3,
) -> str:
    workout_id = str(uuid.uuid4())
    response = await client.put(
        f"/v1/workouts/{workout_id}",
        headers=auth,
        json={
            "title": "Session",
            "started_at": (end - timedelta(hours=1)).isoformat(),
            "ended_at": end.isoformat(),
            "exercises": [
                {
                    "exercise_id": exercise,
                    "sets": [{"weight_kg": 100, "reps": 5} for _ in range(sets)],
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return workout_id


async def get(client: AsyncClient, auth: Headers, path: str) -> dict[str, Any]:
    response = await client.get(path, headers=auth)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def ago(**delta: float) -> datetime:
    return datetime.now(UTC) - timedelta(**delta)


async def test_summary_totals_weeks_and_the_streak(api_client: AsyncClient, auth: Headers) -> None:
    await log(api_client, auth, ago(minutes=10))
    await log(api_client, auth, ago(days=7))
    await log(api_client, auth, ago(days=14), sets=2)
    await log(api_client, auth, ago(days=60))

    body = await get(api_client, auth, "/v1/stats/summary?range=1m")

    assert body["range"] == "1m"
    assert body["workouts"] == 3
    assert body["sets"] == 8
    assert body["volume_kg"] == 4000
    assert body["duration_s"] == 3 * 3600
    assert len(body["weeks"]) in (5, 6)
    assert sum(w["workouts"] for w in body["weeks"]) == 3
    starts = [date.fromisoformat(w["week_start"]) for w in body["weeks"]]
    assert all(s.weekday() == 0 for s in starts)
    assert starts == sorted(starts)
    assert body["streak_weeks"] == 3


async def test_all_time_summary_is_pro(api_client: AsyncClient, auth: Headers) -> None:
    for path in ("/v1/stats/summary?range=1y", "/v1/stats/muscles?range=all"):
        response = await api_client.get(path, headers=auth)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "pro_required"


async def test_an_empty_account(api_client: AsyncClient, auth: Headers) -> None:
    body = await get(api_client, auth, "/v1/stats/summary")

    assert (body["workouts"], body["streak_weeks"]) == (0, 0)
    assert all(w["workouts"] == 0 for w in body["weeks"])
    assert (await get(api_client, auth, "/v1/stats/muscles"))["muscles"] == []


async def test_sets_per_muscle(api_client: AsyncClient, auth: Headers) -> None:
    await log(api_client, auth, ago(days=1), BENCH, sets=3)
    await log(api_client, auth, ago(days=2), BENCH, sets=1)
    await log(api_client, auth, ago(days=3), SQUAT, sets=2)
    await log(api_client, auth, ago(days=40), SQUAT, sets=5)

    body = await get(api_client, auth, "/v1/stats/muscles?range=1m")

    muscles = {m["slug"]: m for m in body["muscles"]}
    assert body["muscles"][0]["slug"] == "chest"
    assert muscles["chest"]["sets"] == 4
    assert muscles["triceps"]["sets"] == 2
    assert muscles["quads"]["sets"] == 2
    assert muscles["chest"]["body_map_key"] and muscles["chest"]["name"] == "Chest"


async def test_calendar_days_are_in_the_users_timezone(
    api_client: AsyncClient, auth: Headers
) -> None:
    await api_client.patch("/v1/me/profile", headers=auth, json={"timezone": "Asia/Kolkata"})
    # Started 20:00 UTC on 30 September: 01:30 on 1 October in India.
    await log(api_client, auth, datetime(2026, 9, 30, 21, 0, tzinfo=UTC))
    await log(api_client, auth, datetime(2026, 10, 14, 12, 0, tzinfo=UTC))
    await log(api_client, auth, datetime(2026, 10, 14, 15, 0, tzinfo=UTC))
    await log(api_client, auth, datetime(2026, 9, 20, 12, 0, tzinfo=UTC))

    october = await get(api_client, auth, "/v1/stats/calendar?month=2026-10")
    september = await get(api_client, auth, "/v1/stats/calendar?month=2026-09")
    bad = await api_client.get("/v1/stats/calendar?month=2026-1", headers=auth)

    assert october["month"] == "2026-10"
    assert october["days"] == [
        {"date": "2026-10-01", "workouts": 1},
        {"date": "2026-10-14", "workouts": 2},
    ]
    assert september["days"] == [{"date": "2026-09-20", "workouts": 1}]
    assert bad.status_code == 422


async def test_saving_a_workout_refreshes_cached_stats(
    api_client: AsyncClient, auth: Headers
) -> None:
    await log(api_client, auth, ago(days=1))
    assert (await get(api_client, auth, "/v1/stats/summary"))["workouts"] == 1

    workout_id = await log(api_client, auth, ago(days=2))
    assert (await get(api_client, auth, "/v1/stats/summary"))["workouts"] == 2

    await api_client.delete(f"/v1/workouts/{workout_id}", headers=auth)
    assert (await get(api_client, auth, "/v1/stats/summary"))["workouts"] == 1


async def test_stats_are_per_user(api_client: AsyncClient, auth: Headers) -> None:
    await log(api_client, auth, ago(days=1))
    other = bearer(await register_user(api_client, email="other@example.com"))

    assert (await get(api_client, other, "/v1/stats/summary"))["workouts"] == 0
    assert (await get(api_client, other, "/v1/stats/muscles"))["muscles"] == []
