import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession

from app.db.change_lock import lock_changes, lock_key
from app.db.models import AuthProvider, RoutineFolder, User
from app.services.library_seed import library_id
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Headers = dict[str, str]
Json = dict[str, Any]

BENCH = str(library_id("exercise", "bench-press-barbell"))


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client))


@pytest.fixture
async def other_auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client, email="other@example.com"))


def new_id() -> str:
    return str(uuid.uuid4())


def at(**delta: float) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


def change(entity: str, row_id: str, data: Json | None = None, **extra: Any) -> Json:
    op = "upsert" if data is not None else "delete"
    return {"entity": entity, "id": row_id, "op": op, "data": data, **extra}


def exercise_data(name: str = "Landmine Press") -> Json:
    return {"name": name, "type": "weight_reps", "equipment": "barbell", "primary_muscle": "chest"}


def routine_data(exercise_id: str = BENCH, **overrides: Any) -> Json:
    return {
        "name": "Push Day",
        "position": 0,
        "exercises": [{"exercise_id": exercise_id, "sets": [{"target_reps": 8}]}],
        **overrides,
    }


def workout_data(exercise_id: str = BENCH, ended: datetime | None = None, **overrides: Any) -> Json:
    end = ended or datetime.now(UTC) - timedelta(minutes=5)
    return {
        "title": "Push Day",
        "started_at": (end - timedelta(hours=1)).isoformat(),
        "ended_at": end.isoformat(),
        "exercises": [{"exercise_id": exercise_id, "sets": [{"weight_kg": 80, "reps": 8}]}],
        **overrides,
    }


async def push(client: AsyncClient, auth: Headers, *changes: Json) -> list[Json]:
    response = await client.post("/v1/sync/push", headers=auth, json={"changes": list(changes)})
    assert response.status_code == 200, response.text
    results: list[Json] = response.json()["results"]
    return results


async def pull(client: AsyncClient, auth: Headers, since: int = 0, limit: int = 200) -> Json:
    response = await client.get(f"/v1/sync/pull?since={since}&limit={limit}", headers=auth)
    assert response.status_code == 200, response.text
    body: Json = response.json()
    return body


def statuses(results: list[Json]) -> list[str]:
    return [r["status"] for r in results]


# --- auth and validation ----------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), [("POST", "/v1/sync/push"), ("GET", "/v1/sync/pull")])
async def test_sync_requires_auth(api_client: AsyncClient, method: str, path: str) -> None:
    assert (await api_client.request(method, path)).status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"changes": [{"entity": "routine", "id": BENCH, "op": "upsert"}]},
        {"changes": [{"entity": "meal", "id": BENCH, "op": "delete"}]},
        {"changes": [change("routine", BENCH)] * 101},
    ],
)
async def test_a_malformed_batch_is_refused(
    api_client: AsyncClient, auth: Headers, body: Json
) -> None:
    response = await api_client.post("/v1/sync/push", headers=auth, json=body)

    assert response.status_code == 422


# --- push and pull round trip -----------------------------------------------------------


async def test_a_new_device_pushes_then_another_pulls(
    api_client: AsyncClient, auth: Headers
) -> None:
    exercise_id, folder_id, routine_id, workout_id = new_id(), new_id(), new_id(), new_id()
    batch = [
        change("exercise", exercise_id, exercise_data()),
        change("routine_folder", folder_id, {"name": "Strength", "position": 3}),
        change("routine", routine_id, routine_data(exercise_id, folder_id=folder_id, position=2)),
        change("workout", workout_id, workout_data(exercise_id, routine_id=routine_id)),
    ]

    results = await push(api_client, auth, *batch)

    assert statuses(results) == ["applied"] * 4
    assert [r["deleted"] for r in results] == [False] * 4
    exercise, folder, routine, workout = (r["data"] for r in results)
    assert exercise["is_custom"] is True
    assert (folder["name"], folder["position"]) == ("Strength", 3)
    assert (routine["folder_id"], routine["position"]) == (folder_id, 2)
    assert routine["exercises"][0]["exercise_name"] == "Landmine Press"
    assert workout["routine_id"] == routine_id
    assert workout["total_volume_kg"] == 640

    pulled = await pull(api_client, auth)

    assert [(c["entity"], c["id"]) for c in pulled["changes"]] == [
        ("exercise", exercise_id),
        ("routine_folder", folder_id),
        ("routine", routine_id),
        ("workout", workout_id),
    ]
    assert [c["data"] for c in pulled["changes"]] == [exercise, folder, routine, workout]
    seqs = [c["change_seq"] for c in pulled["changes"]]
    assert seqs == sorted(seqs)
    assert pulled["cursor"] == seqs[-1]
    assert pulled["has_more"] is False
    assert (await pull(api_client, auth, since=pulled["cursor"]))["changes"] == []


async def test_a_retried_batch_changes_nothing(api_client: AsyncClient, auth: Headers) -> None:
    batch = [
        change("routine_folder", new_id(), {"name": "Strength"}),
        change("routine", new_id(), routine_data()),
        change("workout", new_id(), workout_data()),
    ]
    first = await push(api_client, auth, *batch)
    cursor = (await pull(api_client, auth))["cursor"]

    again = await push(api_client, auth, *batch)

    assert statuses(again) == ["applied"] * 3
    assert [r["data"]["version"] for r in again] == [r["data"]["version"] for r in first]
    assert (await pull(api_client, auth, since=cursor))["changes"] == []


async def test_pull_sees_changes_made_through_the_rest_api(
    api_client: AsyncClient, auth: Headers
) -> None:
    routine_id = new_id()
    await push(api_client, auth, change("routine", routine_id, routine_data()))
    cursor = (await pull(api_client, auth))["cursor"]

    await api_client.patch(f"/v1/routines/{routine_id}", headers=auth, json={"name": "Renamed"})
    pulled = await pull(api_client, auth, since=cursor)

    assert [(c["id"], c["data"]["name"]) for c in pulled["changes"]] == [(routine_id, "Renamed")]


async def test_pull_pages_with_the_cursor(api_client: AsyncClient, auth: Headers) -> None:
    ids = [new_id() for _ in range(5)]
    await push(
        api_client,
        auth,
        *(change("routine_folder", i, {"name": f"F{n}"}) for n, i in enumerate(ids)),
    )

    first = await pull(api_client, auth, limit=2)
    second = await pull(api_client, auth, since=first["cursor"], limit=2)
    third = await pull(api_client, auth, since=second["cursor"], limit=2)

    assert [c["id"] for c in first["changes"] + second["changes"] + third["changes"]] == ids
    assert (first["has_more"], second["has_more"], third["has_more"]) == (True, True, False)


async def test_pull_shows_only_the_users_own_rows(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    await push(api_client, auth, change("exercise", new_id(), exercise_data()))

    pulled = await pull(api_client, other_auth)

    # Nor any library exercise: those sync through GET /exercises.
    assert pulled == {"changes": [], "cursor": 0, "has_more": False}


# --- deletes ----------------------------------------------------------------------------


async def test_deletes_are_pulled_as_tombstones(api_client: AsyncClient, auth: Headers) -> None:
    routine_id, kept_id = new_id(), new_id()
    await push(
        api_client,
        auth,
        change("routine", routine_id, routine_data()),
        change("routine", kept_id, routine_data(name="Legs")),
    )
    cursor = (await pull(api_client, auth))["cursor"]

    deleted = await push(api_client, auth, change("routine", routine_id))
    again = await push(api_client, auth, change("routine", routine_id))
    revived = await push(api_client, auth, change("routine", routine_id, routine_data()))

    assert (deleted[0]["status"], deleted[0]["deleted"], deleted[0]["data"]) == (
        "applied",
        True,
        None,
    )
    assert again[0]["status"] == "applied"
    assert revived[0]["status"] == "rejected"
    assert revived[0]["error"]["code"] == "routine_deleted"
    assert revived[0]["deleted"] is True
    changes = (await pull(api_client, auth, since=cursor))["changes"]
    assert [(c["id"], c["deleted"], c["data"]) for c in changes] == [(routine_id, True, None)]
    # A new device never sees the tombstone.
    assert [c["id"] for c in (await pull(api_client, auth))["changes"]] == [kept_id]


async def test_deleting_something_unknown_is_fine(api_client: AsyncClient, auth: Headers) -> None:
    results = await push(
        api_client,
        auth,
        *(
            change(entity, new_id())
            for entity in ("exercise", "routine_folder", "routine", "workout")
        ),
    )

    assert statuses(results) == ["applied"] * 4


async def test_every_entity_can_be_deleted(api_client: AsyncClient, auth: Headers) -> None:
    rows = [
        ("exercise", new_id(), exercise_data()),
        ("routine_folder", new_id(), {"name": "F"}),
        ("routine", new_id(), routine_data()),
        ("workout", new_id(), workout_data()),
    ]
    await push(api_client, auth, *(change(e, i, d) for e, i, d in rows))

    results = await push(api_client, auth, *(change(e, i) for e, i, _ in reversed(rows)))

    assert statuses(results) == ["applied"] * 4
    assert (await pull(api_client, auth))["changes"] == []


# --- conflicts --------------------------------------------------------------------------


async def test_the_later_edit_wins_a_conflict(api_client: AsyncClient, auth: Headers) -> None:
    folder_id = new_id()
    created = await push(api_client, auth, change("routine_folder", folder_id, {"name": "A"}))
    base = created[0]["data"]["version"]
    # Device 1 renames it.
    first = await push(
        api_client,
        auth,
        change("routine_folder", folder_id, {"name": "B"}, base_version=base, updated_at=at()),
    )

    # Device 2 edited the same version earlier, offline: it loses and gets the server copy.
    older = await push(
        api_client,
        auth,
        change(
            "routine_folder", folder_id, {"name": "C"}, base_version=base, updated_at=at(hours=-1)
        ),
    )
    # An edit made after device 1's wins even though it started from the same version.
    newer = await push(
        api_client,
        auth,
        change(
            "routine_folder", folder_id, {"name": "D"}, base_version=base, updated_at=at(hours=1)
        ),
    )

    assert first[0]["data"]["name"] == "B"
    assert older[0]["status"] == "stale"
    assert older[0]["data"]["name"] == "B"
    assert newer[0]["status"] == "applied"
    assert newer[0]["data"]["name"] == "D"


async def test_an_edit_on_the_current_version_always_applies(
    api_client: AsyncClient, auth: Headers
) -> None:
    folder_id = new_id()
    created = await push(api_client, auth, change("routine_folder", folder_id, {"name": "A"}))

    edited = await push(
        api_client,
        auth,
        change(
            "routine_folder",
            folder_id,
            {"name": "B"},
            base_version=created[0]["data"]["version"],
            updated_at=at(days=-30),
        ),
    )

    assert (edited[0]["status"], edited[0]["data"]["name"]) == ("applied", "B")


# --- rejections -------------------------------------------------------------------------


async def test_a_rejected_change_does_not_stop_the_batch(
    api_client: AsyncClient, auth: Headers
) -> None:
    bad_routine = routine_data(exercise_id=str(uuid.uuid4()))

    results = await push(
        api_client,
        auth,
        change("routine", new_id(), bad_routine),
        change("workout", new_id(), {**workout_data(), "title": ""}),
        change("routine_folder", new_id(), {"name": "Still saved"}),
    )

    assert statuses(results) == ["rejected", "rejected", "applied"]
    unknown, invalid, _ = results
    assert unknown["error"]["code"] == "validation_error"
    assert unknown["error"]["details"][0]["loc"] == ["body", "exercises", 0, "exercise_id"]
    # Never created: the app removes its local copy.
    assert (unknown["deleted"], unknown["data"]) == (True, None)
    assert invalid["error"]["details"][0]["loc"] == ["data", "title"]


async def test_library_exercises_are_read_only(api_client: AsyncClient, auth: Headers) -> None:
    results = await push(
        api_client, auth, change("exercise", BENCH, exercise_data()), change("exercise", BENCH)
    )

    assert statuses(results) == ["rejected", "rejected"]
    for result in results:
        assert result["error"]["code"] == "library_exercise_read_only"
        # The library copy is returned, never a deletion.
        assert result["deleted"] is False
        assert result["data"]["name"] == "Bench Press (Barbell)"


async def test_another_users_ids_are_not_touched(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    routine_id = new_id()
    await push(api_client, other_auth, change("routine", routine_id, routine_data()))

    results = await push(
        api_client,
        auth,
        change("routine", routine_id, routine_data(name="Mine now")),
        change("routine", routine_id),
    )

    assert statuses(results) == ["rejected", "applied"]
    assert results[0]["error"]["code"] == "routine_exists"
    assert results[0]["data"] is None
    theirs = await pull(api_client, other_auth)
    assert theirs["changes"][0]["data"]["name"] == "Push Day"


async def test_an_old_workout_edit_gets_the_server_copy(
    api_client: AsyncClient, auth: Headers
) -> None:
    workout_id = new_id()
    end = datetime.now(UTC) - timedelta(days=2)
    await push(api_client, auth, change("workout", workout_id, workout_data(ended=end)))

    results = await push(
        api_client, auth, change("workout", workout_id, workout_data(ended=end, title="Renamed"))
    )

    assert results[0]["status"] == "rejected"
    assert results[0]["error"]["code"] == "workout_immutable"
    assert results[0]["data"]["title"] == "Push Day"


async def test_a_custom_exercise_type_cannot_change(api_client: AsyncClient, auth: Headers) -> None:
    exercise_id = new_id()
    await push(api_client, auth, change("exercise", exercise_id, exercise_data()))

    renamed = await push(
        api_client, auth, change("exercise", exercise_id, exercise_data("Landmine Press (1 arm)"))
    )
    retyped = await push(
        api_client,
        auth,
        change("exercise", exercise_id, {**exercise_data(), "type": "bodyweight_reps"}),
    )

    assert renamed[0]["data"]["name"] == "Landmine Press (1 arm)"
    assert renamed[0]["data"]["version"] == 2
    assert retyped[0]["error"]["code"] == "exercise_type_immutable"
    assert retyped[0]["data"]["type"] == "weight_reps"


async def test_a_routine_in_a_deleted_folder_goes_to_no_folder(
    api_client: AsyncClient, auth: Headers
) -> None:
    folder_id = new_id()
    await push(api_client, auth, change("routine_folder", folder_id, {"name": "Gone"}))
    await push(api_client, auth, change("routine_folder", folder_id))

    results = await push(
        api_client, auth, change("routine", new_id(), routine_data(folder_id=folder_id))
    )

    assert results[0]["status"] == "applied"
    assert results[0]["data"]["folder_id"] is None


async def test_the_free_routine_limit_holds(api_client: AsyncClient, auth: Headers) -> None:
    results = await push(
        api_client, auth, *(change("routine", new_id(), routine_data()) for _ in range(5))
    )

    assert statuses(results) == ["applied"] * 4 + ["rejected"]
    assert results[-1]["error"]["code"] == "routine_limit_reached"


async def test_moving_and_editing_a_routine(api_client: AsyncClient, auth: Headers) -> None:
    folder_id, routine_id = new_id(), new_id()
    created = await push(
        api_client,
        auth,
        change("routine_folder", folder_id, {"name": "F"}),
        change("routine", routine_id, routine_data(position=4)),
    )
    routine = created[1]["data"]

    unchanged = await push(
        api_client, auth, change("routine", routine_id, routine_data(position=4))
    )
    moved = await push(
        api_client,
        auth,
        change(
            "routine",
            routine_id,
            routine_data(folder_id=folder_id, position=1, notes="Heavy"),
            base_version=routine["version"],
        ),
    )

    assert unchanged[0]["data"]["version"] == routine["version"]
    data = moved[0]["data"]
    assert (data["folder_id"], data["position"], data["notes"]) == (folder_id, 1, "Heavy")
    assert data["version"] == routine["version"] + 1


# --- the change lock --------------------------------------------------------------------


async def _try_shared(conn: AsyncConnection, user_id: uuid.UUID) -> bool:
    result = await conn.execute(
        text("SELECT pg_try_advisory_xact_lock_shared(hashtextextended(:key, 0))"),
        {"key": lock_key(user_id)},
    )
    held: bool = result.scalar_one()
    return held


async def test_a_pull_waits_for_writes_in_flight(engine: AsyncEngine) -> None:
    user_id = uuid.uuid4()
    async with engine.connect() as writer, engine.connect() as reader:
        await writer.begin()
        await lock_changes(AsyncSession(bind=writer), user_id)
        await reader.begin()
        assert await _try_shared(reader, user_id) is False
        # Other users are not blocked.
        assert await _try_shared(reader, uuid.uuid4()) is True
        await writer.rollback()
        assert await _try_shared(reader, user_id) is True
        await reader.rollback()


async def test_writing_a_syncable_row_takes_the_lock_by_itself(engine: AsyncEngine) -> None:
    user_id = uuid.uuid4()
    async with engine.connect() as writer, engine.connect() as reader:
        await writer.begin()
        session = AsyncSession(bind=writer)
        session.add(
            User(
                id=user_id,
                email=f"{user_id}@example.com",
                auth_provider=AuthProvider.PASSWORD,
                username=f"u{user_id.hex[:12]}",
                display_name="Lock",
            )
        )
        await session.flush()
        await reader.begin()
        assert await _try_shared(reader, user_id) is True
        await reader.rollback()

        session.add(RoutineFolder(user_id=user_id, name="Locked"))
        await session.flush()

        await reader.begin()
        assert await _try_shared(reader, user_id) is False
        await reader.rollback()
        await writer.rollback()
