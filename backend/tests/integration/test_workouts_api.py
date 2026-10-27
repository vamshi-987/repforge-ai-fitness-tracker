import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from httpx import AsyncClient

from app.services import stats
from app.services import workouts as workout_service
from app.services.library_seed import library_id
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Headers = dict[str, str]

BENCH = str(library_id("exercise", "bench-press-barbell"))
SQUAT = str(library_id("exercise", "squat-barbell"))
PULLUP = str(library_id("exercise", "pull-up"))
MISSING = str(uuid.uuid4())


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client))


@pytest.fixture
async def other_auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client, email="other@example.com"))


def iso(moment: datetime) -> str:
    return moment.isoformat()


def ago(**delta: float) -> datetime:
    return datetime.now(UTC) - timedelta(**delta)


def workout(ended: datetime | None = None, **overrides: Any) -> dict[str, Any]:
    end = ended or ago(minutes=5)
    return {
        "title": "Push Day",
        "notes": "Felt strong.",
        "started_at": iso(end - timedelta(hours=1)),
        "ended_at": iso(end),
        "visibility": "public",
        "exercises": [
            {
                "exercise_id": BENCH,
                "notes": "Paused reps",
                "sets": [
                    {"set_type": "warmup", "weight_kg": 40, "reps": 10},
                    {"weight_kg": 80.125, "reps": 8, "rpe": 8.5},
                    {"weight_kg": 80, "reps": 8},
                ],
            },
            {"exercise_id": SQUAT, "superset_group": 7, "sets": [{"weight_kg": 100, "reps": 5}]},
            {"exercise_id": PULLUP, "superset_group": 7, "sets": [{"reps": 10}]},
        ],
        **overrides,
    }


def bench(*sets: tuple[float, int]) -> list[dict[str, Any]]:
    return [{"exercise_id": BENCH, "sets": [{"weight_kg": w, "reps": r} for w, r in sets]}]


async def put(
    client: AsyncClient, auth: Headers, workout_id: str, body: dict[str, Any], status: int = 201
) -> dict[str, Any]:
    response = await client.put(f"/v1/workouts/{workout_id}", headers=auth, json=body)
    assert response.status_code == status, response.text
    result: dict[str, Any] = response.json()
    return result


async def fetch(client: AsyncClient, auth: Headers, workout_id: str) -> dict[str, Any]:
    response = await client.get(f"/v1/workouts/{workout_id}", headers=auth)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def assert_error(response: Any, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


def records(body: dict[str, Any], kind: str = "heaviest") -> list[tuple[float, float | None]]:
    return [(r["value"], r["previous_value"]) for r in body["records"] if r["record_type"] == kind]


# --- auth -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/workouts"),
        ("PUT", f"/v1/workouts/{MISSING}"),
        ("GET", f"/v1/workouts/{MISSING}"),
        ("DELETE", f"/v1/workouts/{MISSING}"),
    ],
)
async def test_everything_requires_auth(api_client: AsyncClient, method: str, path: str) -> None:
    response = await api_client.request(method, path)

    assert response.status_code == 401


# --- create -----------------------------------------------------------------------------


async def test_put_creates_the_workout_with_its_aggregates(
    api_client: AsyncClient, auth: Headers
) -> None:
    workout_id = str(uuid.uuid4())
    body = workout()

    created = await put(api_client, auth, workout_id, body)

    assert created["id"] == workout_id
    assert created["title"] == "Push Day"
    assert created["visibility"] == "public"
    assert created["duration_s"] == 3600
    assert created["version"] == 1
    # 40x10 + 80.13x8 + 80x8 + 100x5 (pull-ups carry no load)
    assert created["total_volume_kg"] == 2181.04
    assert created["total_sets"] == 5
    bench_row, squat_row, pullup_row = created["exercises"]
    assert bench_row["exercise_name"] == "Bench Press (Barbell)"
    assert bench_row["exercise_type"] == "weight_reps"
    assert [s["weight_kg"] for s in bench_row["sets"]] == [40, 80.13, 80]
    assert bench_row["sets"][1]["rpe"] == 8.5
    assert (squat_row["superset_group"], pullup_row["superset_group"]) == (1, 1)
    assert created["muscle_sets"]["chest"] == 2
    assert created["muscle_sets"]["quads"] == 1
    # The first session sets baselines, which are stored but are not PRs yet.
    assert records(created) == [(80.13, None), (100, None)]
    assert records(created, "most_reps") == [(10, None)]
    first_set = created["records"][0]["set_id"]
    assert first_set == bench_row["sets"][1]["id"]

    assert await fetch(api_client, auth, workout_id) == created


async def test_a_retried_put_changes_nothing(api_client: AsyncClient, auth: Headers) -> None:
    workout_id = str(uuid.uuid4())
    body = workout()
    created = await put(api_client, auth, workout_id, body)

    again = await put(api_client, auth, workout_id, body, status=200)

    assert again == created
    listed = await api_client.get("/v1/workouts", headers=auth)
    assert len(listed.json()["items"]) == 1


async def test_a_first_save_race_ends_as_one_workout(
    api_client: AsyncClient, auth: Headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    workout_id = str(uuid.uuid4())
    body = workout()
    created = await put(api_client, auth, workout_id, body)
    real_find = workout_service._find
    calls = 0

    async def misses_once(*args: Any, **kwargs: Any) -> Any:
        # The second request's existence check ran before the first one committed.
        nonlocal calls
        calls += 1
        return None if calls == 1 else await real_find(*args, **kwargs)

    monkeypatch.setattr(workout_service, "_find", misses_once)

    again = await put(api_client, auth, workout_id, body, status=200)

    assert again["version"] == created["version"]
    assert calls >= 2


async def test_the_stats_cache_generation_moves(
    api_client: AsyncClient, auth: Headers, fake_redis: FakeAsyncRedis
) -> None:
    workout_id = str(uuid.uuid4())
    created = await put(api_client, auth, workout_id, workout())
    me = (await api_client.get("/v1/me", headers=auth)).json()
    key = stats.generation_key(uuid.UUID(me["id"]))
    assert await fake_redis.get(key) == "1"

    await api_client.delete(f"/v1/workouts/{created['id']}", headers=auth)

    assert await fake_redis.get(key) == "2"


# --- validation -------------------------------------------------------------------------


async def test_an_end_in_the_future_is_refused(api_client: AsyncClient, auth: Headers) -> None:
    response = await api_client.put(
        f"/v1/workouts/{uuid.uuid4()}", headers=auth, json=workout(ended=ago(minutes=-30))
    )

    assert_error(response, 422, "validation_error")
    assert response.json()["error"]["details"][0]["loc"] == ["body", "ended_at"]


async def test_superset_members_must_be_adjacent(api_client: AsyncClient, auth: Headers) -> None:
    body = workout()
    body["exercises"][0]["superset_group"] = 7
    body["exercises"][1]["superset_group"] = None

    response = await api_client.put(f"/v1/workouts/{uuid.uuid4()}", headers=auth, json=body)

    assert_error(response, 422, "validation_error")
    assert response.json()["error"]["details"][0]["loc"] == [
        "body",
        "exercises",
        2,
        "superset_group",
    ]


async def test_exercises_must_be_library_or_own(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    theirs = await api_client.post(
        "/v1/exercises",
        headers=other_auth,
        json={
            "name": "Theirs",
            "type": "weight_reps",
            "equipment": "barbell",
            "primary_muscle": "chest",
        },
    )
    for index, exercise_id in enumerate([MISSING, theirs.json()["id"]]):
        body = workout()
        body["exercises"][index]["exercise_id"] = exercise_id

        response = await api_client.put(f"/v1/workouts/{uuid.uuid4()}", headers=auth, json=body)

        assert_error(response, 422, "validation_error")
        assert response.json()["error"]["details"][0]["loc"] == [
            "body",
            "exercises",
            index,
            "exercise_id",
        ]


async def test_a_deleted_custom_exercise_is_still_accepted(
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
    await api_client.delete(f"/v1/exercises/{custom_id}", headers=auth)
    body = workout(exercises=[{"exercise_id": custom_id, "sets": [{"weight_kg": 50, "reps": 5}]}])

    created = await put(api_client, auth, str(uuid.uuid4()), body)

    assert created["exercises"][0]["exercise_name"] == "Old Lift"


async def test_only_own_routines_are_linked(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    mine = await api_client.post("/v1/routines", headers=auth, json={"name": "Mine"})
    theirs = await api_client.post("/v1/routines", headers=other_auth, json={"name": "Theirs"})

    linked = await put(api_client, auth, str(uuid.uuid4()), workout(routine_id=mine.json()["id"]))
    dropped = await put(
        api_client, auth, str(uuid.uuid4()), workout(routine_id=theirs.json()["id"])
    )
    unknown = await put(api_client, auth, str(uuid.uuid4()), workout(routine_id=MISSING))

    assert linked["routine_id"] == mine.json()["id"]
    assert dropped["routine_id"] is None
    assert unknown["routine_id"] is None


# --- changes and the 24-hour rule -------------------------------------------------------


async def test_a_change_within_24_hours_replaces_the_workout(
    api_client: AsyncClient, auth: Headers
) -> None:
    workout_id = str(uuid.uuid4())
    end = ago(hours=23)
    await put(api_client, auth, workout_id, workout(ended=end))

    changed = await put(
        api_client,
        auth,
        workout_id,
        workout(ended=end, title="Push Day (heavy)", exercises=bench((100, 5), (100, 5))),
        status=200,
    )

    assert changed["version"] == 2
    assert changed["title"] == "Push Day (heavy)"
    assert changed["total_volume_kg"] == 1000
    assert changed["total_sets"] == 2
    assert set(changed["muscle_sets"]) == {"chest", "front_delts", "triceps"}
    # Squat and pull-up are gone from this workout, and so are their records.
    assert {r["exercise_id"] for r in changed["records"]} == {BENCH}


async def test_after_24_hours_the_content_is_locked(api_client: AsyncClient, auth: Headers) -> None:
    workout_id = str(uuid.uuid4())
    end = ago(hours=25)
    created = await put(api_client, auth, workout_id, workout(ended=end))

    edited = await api_client.put(
        f"/v1/workouts/{workout_id}", headers=auth, json=workout(ended=end, title="Renamed")
    )
    # The original save, retried late, is still fine: nothing changes.
    retried = await put(api_client, auth, workout_id, workout(ended=end), status=200)
    # Visibility is a privacy control and can change at any time.
    hidden = await put(
        api_client, auth, workout_id, workout(ended=end, visibility="private"), status=200
    )

    assert_error(edited, 409, "workout_immutable")
    assert edited.json()["error"]["details"] == {"version": 1}
    assert retried["version"] == 1
    assert hidden["visibility"] == "private"
    assert hidden["version"] == 2
    assert hidden["title"] == created["title"]


async def test_another_users_id_is_taken(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    workout_id = str(uuid.uuid4())
    await put(api_client, auth, workout_id, workout())

    response = await api_client.put(
        f"/v1/workouts/{workout_id}", headers=other_auth, json=workout()
    )
    fetched = await api_client.get(f"/v1/workouts/{workout_id}", headers=other_auth)
    deleted = await api_client.delete(f"/v1/workouts/{workout_id}", headers=other_auth)

    assert_error(response, 409, "workout_exists")
    assert_error(fetched, 404, "not_found")
    assert_error(deleted, 404, "not_found")


async def test_a_deleted_workout_stays_deleted(api_client: AsyncClient, auth: Headers) -> None:
    workout_id = str(uuid.uuid4())
    await put(api_client, auth, workout_id, workout())

    removed = await api_client.delete(f"/v1/workouts/{workout_id}", headers=auth)
    fetched = await api_client.get(f"/v1/workouts/{workout_id}", headers=auth)
    again = await api_client.delete(f"/v1/workouts/{workout_id}", headers=auth)
    revived = await api_client.put(f"/v1/workouts/{workout_id}", headers=auth, json=workout())

    assert removed.status_code == 204
    assert_error(fetched, 404, "not_found")
    assert_error(again, 404, "not_found")
    assert_error(revived, 409, "workout_deleted")


# --- history ----------------------------------------------------------------------------


async def test_list_is_newest_first_with_a_cursor(api_client: AsyncClient, auth: Headers) -> None:
    ids = [str(uuid.uuid4()) for _ in range(5)]
    for days, workout_id in enumerate(ids):
        await put(api_client, auth, workout_id, workout(ended=ago(days=days, minutes=5)))
    await api_client.delete(f"/v1/workouts/{ids[2]}", headers=auth)

    first = await api_client.get("/v1/workouts?limit=2", headers=auth)
    second = await api_client.get(
        f"/v1/workouts?limit=2&cursor={first.json()['next_cursor']}", headers=auth
    )

    assert [w["id"] for w in first.json()["items"]] == ids[:2]
    assert [w["id"] for w in second.json()["items"]] == [ids[3], ids[4]]
    assert second.json()["next_cursor"] is None


async def test_list_rejects_a_bad_cursor(api_client: AsyncClient, auth: Headers) -> None:
    response = await api_client.get("/v1/workouts?cursor=nope", headers=auth)

    assert_error(response, 422, "invalid_cursor")


async def test_list_shows_only_own_workouts(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    await put(api_client, auth, str(uuid.uuid4()), workout())

    response = await api_client.get("/v1/workouts", headers=other_auth)

    assert response.json() == {"items": [], "next_cursor": None}


# --- records ----------------------------------------------------------------------------


async def test_a_heavier_session_is_a_record(api_client: AsyncClient, auth: Headers) -> None:
    await put(
        api_client, auth, str(uuid.uuid4()), workout(ended=ago(days=2), exercises=bench((100, 5)))
    )
    same = await put(
        api_client, auth, str(uuid.uuid4()), workout(ended=ago(days=1), exercises=bench((100, 5)))
    )
    heavier = await put(api_client, auth, str(uuid.uuid4()), workout(exercises=bench((105, 3))))

    assert same["records"] == []
    assert records(heavier) == [(105, 100)]
    # e1RM didn't improve: 105 x 1.1 = 115.5 < 100 x 1.1667 = 116.67
    assert records(heavier, "e1rm") == []


async def test_a_late_older_workout_takes_its_place(api_client: AsyncClient, auth: Headers) -> None:
    newer_id = str(uuid.uuid4())
    newer = await put(
        api_client, auth, newer_id, workout(ended=ago(days=1), exercises=bench((100, 5)))
    )
    assert records(newer) == [(100, None)]

    # Logged offline two days ago, synced only now, and heavier.
    older = await put(
        api_client, auth, str(uuid.uuid4()), workout(ended=ago(days=2), exercises=bench((110, 5)))
    )

    assert records(older) == [(110, None)]
    refreshed = await fetch(api_client, auth, newer_id)
    assert records(refreshed) == []
    # Its records changed, so other devices must pull it again.
    assert refreshed["version"] == newer["version"] + 1


async def test_deleting_a_workout_gives_later_ones_their_records_back(
    api_client: AsyncClient, auth: Headers
) -> None:
    first_id, second_id = str(uuid.uuid4()), str(uuid.uuid4())
    await put(api_client, auth, first_id, workout(ended=ago(days=2), exercises=bench((100, 5))))
    second = await put(
        api_client, auth, second_id, workout(ended=ago(days=1), exercises=bench((105, 5)))
    )
    assert records(second) == [(105, 100)]

    await api_client.delete(f"/v1/workouts/{first_id}", headers=auth)

    assert records(await fetch(api_client, auth, second_id)) == [(105, None)]
