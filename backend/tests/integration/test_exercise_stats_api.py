import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import User
from app.services.library_seed import library_id
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Headers = dict[str, str]

BENCH = str(library_id("exercise", "bench-press-barbell"))
PULLUP = str(library_id("exercise", "pull-up"))


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client))


async def log(
    client: AsyncClient,
    auth: Headers,
    days_ago: float,
    exercises: list[dict[str, Any]],
    title: str = "Push",
) -> str:
    end = datetime.now(UTC) - timedelta(days=days_ago)
    workout_id = str(uuid.uuid4())
    response = await client.put(
        f"/v1/workouts/{workout_id}",
        headers=auth,
        json={
            "title": title,
            "started_at": (end - timedelta(hours=1)).isoformat(),
            "ended_at": end.isoformat(),
            "exercises": exercises,
        },
    )
    assert response.status_code == 201, response.text
    return workout_id


def bench(*sets: tuple[float, int]) -> dict[str, Any]:
    return {"exercise_id": BENCH, "sets": [{"weight_kg": w, "reps": r} for w, r in sets]}


async def test_history_lists_sessions_newest_first(api_client: AsyncClient, auth: Headers) -> None:
    older = await log(api_client, auth, 10, [bench((100, 5))], title="Older")
    # Bench twice in one workout: one session with both sets.
    newer = await log(
        api_client,
        auth,
        1,
        [bench((102.5, 5)), {"exercise_id": PULLUP, "sets": [{"reps": 8}]}, bench((90, 8))],
        title="Newer",
    )
    await log(api_client, auth, 5, [{"exercise_id": PULLUP, "sets": [{"reps": 8}]}])

    first = await api_client.get(f"/v1/exercises/{BENCH}/history?limit=1", headers=auth)
    second = await api_client.get(
        f"/v1/exercises/{BENCH}/history?limit=1&cursor={first.json()['next_cursor']}",
        headers=auth,
    )

    assert first.status_code == 200, first.text
    (session,) = first.json()["items"]
    assert (session["workout_id"], session["workout_title"]) == (newer, "Newer")
    assert [(s["weight_kg"], s["reps"]) for s in session["sets"]] == [(102.5, 5), (90, 8)]
    assert [s["workout_id"] for s in second.json()["items"]] == [older]
    assert second.json()["next_cursor"] is None


async def test_stats_give_a_point_per_session_and_the_records(
    api_client: AsyncClient, auth: Headers
) -> None:
    first = await log(api_client, auth, 20, [bench((100, 5))])
    second = await log(api_client, auth, 10, [bench((105, 3), (95, 8))])
    await log(api_client, auth, 200, [bench((140, 1))])  # outside 3 months

    response = await api_client.get(f"/v1/exercises/{BENCH}/stats", headers=auth)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["range"] == "3m"
    assert [(p["workout_id"], p["heaviest_kg"], p["total_reps"]) for p in body["points"]] == [
        (first, 100, 5),
        (second, 105, 11),
    ]
    assert body["points"][1]["best_set_volume_kg"] == 760
    assert body["points"][1]["e1rm_kg"] == 120.33
    assert body["points"][1]["e1rm_low_accuracy"] is False
    records = {r["record_type"]: (r["value"], r["workout_id"]) for r in body["records"]}
    # All-time bests, whatever the range: the 140 kg single from 200 days ago.
    assert records["heaviest"][0] == 140
    assert records["best_set_volume"] == (760, second)


async def test_long_ranges_are_pro(
    api_client: AsyncClient, auth: Headers, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await log(api_client, auth, 200, [bench((140, 1))])

    month = await api_client.get(f"/v1/exercises/{BENCH}/stats?range=1m", headers=auth)
    free = await api_client.get(f"/v1/exercises/{BENCH}/stats?range=1y", headers=auth)
    async with session_factory() as session:
        await session.execute(
            update(User).where(User.email == "lifter@example.com").values(is_pro=True)
        )
        await session.commit()
    pro = await api_client.get(f"/v1/exercises/{BENCH}/stats?range=all", headers=auth)
    bad = await api_client.get(f"/v1/exercises/{BENCH}/stats?range=2w", headers=auth)

    assert month.json()["points"] == []
    assert free.status_code == 403
    assert free.json()["error"]["code"] == "pro_required"
    assert len(pro.json()["points"]) == 1
    assert bad.status_code == 422


async def test_bodyweight_exercises_chart_reps(api_client: AsyncClient, auth: Headers) -> None:
    await log(api_client, auth, 1, [{"exercise_id": PULLUP, "sets": [{"reps": 10}, {"reps": 8}]}])

    body = (await api_client.get(f"/v1/exercises/{PULLUP}/stats", headers=auth)).json()

    (point,) = body["points"]
    assert (point["heaviest_kg"], point["total_reps"]) == (None, 18)
    assert [(r["record_type"], r["value"]) for r in body["records"]] == [("most_reps", 10)]


async def test_other_users_data_is_never_shown(api_client: AsyncClient, auth: Headers) -> None:
    await log(api_client, auth, 1, [bench((100, 5))])
    other = bearer(await register_user(api_client, email="other@example.com"))
    custom = await api_client.post(
        "/v1/exercises",
        headers=other,
        json={
            "name": "Theirs",
            "type": "weight_reps",
            "equipment": "barbell",
            "primary_muscle": "chest",
        },
    )

    history = await api_client.get(f"/v1/exercises/{BENCH}/history", headers=other)
    stats = await api_client.get(f"/v1/exercises/{BENCH}/stats", headers=other)
    foreign = await api_client.get(f"/v1/exercises/{custom.json()['id']}/stats", headers=auth)
    unknown = await api_client.get(f"/v1/exercises/{uuid.uuid4()}/history", headers=auth)

    assert history.json() == {"items": [], "next_cursor": None}
    assert stats.json()["points"] == [] and stats.json()["records"] == []
    assert foreign.status_code == 404
    assert unknown.status_code == 404


async def test_a_deleted_custom_exercise_keeps_its_history(
    api_client: AsyncClient, auth: Headers
) -> None:
    custom = await api_client.post(
        "/v1/exercises",
        headers=auth,
        json={
            "name": "Old Lift",
            "type": "weight_reps",
            "equipment": "barbell",
            "primary_muscle": "chest",
        },
    )
    custom_id = custom.json()["id"]
    await log(
        api_client, auth, 1, [{"exercise_id": custom_id, "sets": [{"weight_kg": 50, "reps": 5}]}]
    )
    await api_client.delete(f"/v1/exercises/{custom_id}", headers=auth)

    response = await api_client.get(f"/v1/exercises/{custom_id}/history", headers=auth)

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
