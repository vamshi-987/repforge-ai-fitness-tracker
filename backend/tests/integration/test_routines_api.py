import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import User
from app.services import routines as routine_service
from app.services.library_seed import library_id
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Sessions = async_sessionmaker[AsyncSession]
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


async def make_pro(session_factory: Sessions, email: str = "lifter@example.com") -> None:
    async with session_factory() as session:
        await session.execute(update(User).where(User.email == email).values(is_pro=True))
        await session.commit()


def push_day(**overrides: Any) -> dict[str, Any]:
    return {
        "name": "Push Day",
        "notes": "Bench first.",
        "exercises": [
            {
                "exercise_id": BENCH,
                "rest_seconds": 180,
                "rep_range_min": 6,
                "rep_range_max": 10,
                "notes": "Pause the first rep",
                "sets": [
                    {"set_type": "warmup", "target_weight_kg": 40, "target_reps": 10},
                    {"target_weight_kg": 80.125, "target_reps": 8},
                    {"set_type": "failure", "target_weight_kg": 80, "target_reps": 8},
                ],
            },
            {"exercise_id": SQUAT, "superset_group": 4, "sets": [{"target_reps": 5}]},
            {"exercise_id": PULLUP, "superset_group": 4, "sets": [{"target_reps": 8}]},
        ],
        **overrides,
    }


async def create(client: AsyncClient, auth: Headers, **overrides: Any) -> dict[str, Any]:
    response = await client.post("/v1/routines", headers=auth, json=push_day(**overrides))
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def create_custom_exercise(client: AsyncClient, auth: Headers, name: str) -> str:
    response = await client.post(
        "/v1/exercises",
        headers=auth,
        json={
            "name": name,
            "type": "weight_reps",
            "equipment": "barbell",
            "primary_muscle": "chest",
        },
    )
    assert response.status_code == 201, response.text
    exercise_id: str = response.json()["id"]
    return exercise_id


async def create_folder(client: AsyncClient, auth: Headers, name: str) -> dict[str, Any]:
    response = await client.post("/v1/routine-folders", headers=auth, json={"name": name})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def listing(client: AsyncClient, auth: Headers) -> dict[str, Any]:
    response = await client.get("/v1/routines", headers=auth)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def order(items: list[dict[str, Any]]) -> list[tuple[str | None, int, str]]:
    return [(r["folder_id"], r["position"], r["name"]) for r in items]


def assert_invalid(response: Any, loc: list[Any]) -> None:
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["details"][0]["loc"] == loc


# --- auth -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/routines"),
        ("POST", "/v1/routines"),
        ("POST", "/v1/routines/reorder"),
        ("GET", f"/v1/routines/{MISSING}"),
        ("PATCH", f"/v1/routines/{MISSING}"),
        ("DELETE", f"/v1/routines/{MISSING}"),
        ("POST", f"/v1/routines/{MISSING}/duplicate"),
        ("GET", "/v1/routine-folders"),
        ("POST", "/v1/routine-folders"),
        ("POST", "/v1/routine-folders/reorder"),
        ("PATCH", f"/v1/routine-folders/{MISSING}"),
        ("DELETE", f"/v1/routine-folders/{MISSING}"),
    ],
)
async def test_everything_requires_auth(api_client: AsyncClient, method: str, path: str) -> None:
    response = await api_client.request(method, path)

    assert response.status_code == 401


# --- create and read --------------------------------------------------------------------


async def test_create_returns_the_whole_routine(api_client: AsyncClient, auth: Headers) -> None:
    routine = await create(api_client, auth)

    assert routine["name"] == "Push Day"
    assert routine["notes"] == "Bench first."
    assert routine["folder_id"] is None
    assert routine["position"] == 0
    assert routine["version"] == 1
    bench, squat, pullup = routine["exercises"]
    assert bench == {
        "exercise_id": BENCH,
        "exercise_name": "Bench Press (Barbell)",
        "exercise_type": "weight_reps",
        "superset_group": None,
        "rest_seconds": 180,
        "rep_range_min": 6,
        "rep_range_max": 10,
        "notes": "Pause the first rep",
        "sets": [
            {"set_type": "warmup", "target_weight_kg": 40.0, "target_reps": 10,
             "target_duration_s": None},
            {"set_type": "normal", "target_weight_kg": 80.13, "target_reps": 8,
             "target_duration_s": None},
            {"set_type": "failure", "target_weight_kg": 80.0, "target_reps": 8,
             "target_duration_s": None},
        ],
    }  # fmt: skip
    # Superset groups are renumbered from 1.
    assert (squat["superset_group"], pullup["superset_group"]) == (1, 1)
    assert pullup["exercise_type"] == "bodyweight_reps"

    fetched = await api_client.get(f"/v1/routines/{routine['id']}", headers=auth)
    assert fetched.status_code == 200
    assert fetched.json() == routine


async def test_list_shows_routines_in_order_with_the_limit(
    api_client: AsyncClient, auth: Headers
) -> None:
    await create(api_client, auth, name="A")
    await create(api_client, auth, name="B", exercises=[])

    body = await listing(api_client, auth)

    assert order(body["items"]) == [(None, 0, "A"), (None, 1, "B")]
    assert body["items"][1]["exercises"] == []
    assert body["routine_limit"] == 4


async def test_client_id_is_used_once(api_client: AsyncClient, auth: Headers) -> None:
    routine_id = str(uuid.uuid4())

    first = await api_client.post("/v1/routines", headers=auth, json=push_day(id=routine_id))
    again = await api_client.post("/v1/routines", headers=auth, json=push_day(id=routine_id))

    assert first.status_code == 201
    assert first.json()["id"] == routine_id
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "routine_exists"


async def test_id_race_is_caught_by_the_primary_key(
    api_client: AsyncClient, auth: Headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    routine = await create(api_client, auth)

    async def looks_free(*_: object) -> None:
        return None

    monkeypatch.setattr(routine_service, "_ensure_routine_id_free", looks_free)

    response = await api_client.post("/v1/routines", headers=auth, json=push_day(id=routine["id"]))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "routine_exists"


async def test_unknown_exercise_is_reported_on_its_row(
    api_client: AsyncClient, auth: Headers
) -> None:
    body = push_day()
    body["exercises"][1]["exercise_id"] = MISSING

    response = await api_client.post("/v1/routines", headers=auth, json=body)

    assert_invalid(response, ["body", "exercises", 1, "exercise_id"])


async def test_custom_exercises_are_private(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    custom_id = await create_custom_exercise(api_client, auth, "My Press")
    mine = {"exercise_id": custom_id, "sets": [{"target_reps": 5}]}

    own = await api_client.post("/v1/routines", headers=auth, json=push_day(exercises=[mine]))
    theirs = await api_client.post(
        "/v1/routines", headers=other_auth, json=push_day(exercises=[mine])
    )

    assert own.status_code == 201
    assert own.json()["exercises"][0]["exercise_name"] == "My Press"
    assert_invalid(theirs, ["body", "exercises", 0, "exercise_id"])


async def test_superset_members_must_be_adjacent(api_client: AsyncClient, auth: Headers) -> None:
    body = push_day()
    body["exercises"][0]["superset_group"] = 4
    body["exercises"][1]["superset_group"] = None

    response = await api_client.post("/v1/routines", headers=auth, json=body)

    assert_invalid(response, ["body", "exercises", 2, "superset_group"])


async def test_bad_rep_range_is_a_validation_error(api_client: AsyncClient, auth: Headers) -> None:
    body = push_day()
    body["exercises"][0]["rep_range_min"] = 12

    response = await api_client.post("/v1/routines", headers=auth, json=body)

    assert response.status_code == 422


async def test_other_users_routines_are_not_found(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    routine = await create(api_client, auth)
    path = f"/v1/routines/{routine['id']}"

    responses = [
        await api_client.get(path, headers=other_auth),
        await api_client.patch(path, headers=other_auth, json={"name": "Mine now"}),
        await api_client.delete(path, headers=other_auth),
        await api_client.post(f"{path}/duplicate", headers=other_auth),
    ]

    assert [r.status_code for r in responses] == [404, 404, 404, 404]
    assert (await listing(api_client, other_auth))["items"] == []
    assert (await api_client.get(path, headers=auth)).json()["name"] == "Push Day"


# --- free-tier limit --------------------------------------------------------------------


async def test_free_accounts_keep_four_routines(api_client: AsyncClient, auth: Headers) -> None:
    routines = [await create(api_client, auth, name=f"R{i}") for i in range(4)]

    fifth = await api_client.post("/v1/routines", headers=auth, json=push_day())
    copy = await api_client.post(f"/v1/routines/{routines[0]['id']}/duplicate", headers=auth)

    for response in (fifth, copy):
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "routine_limit_reached"
        assert response.json()["error"]["details"] == {"limit": 4}

    # Deleting one frees a slot.
    await api_client.delete(f"/v1/routines/{routines[0]['id']}", headers=auth)
    assert (await api_client.post("/v1/routines", headers=auth, json=push_day())).status_code == 201


async def test_pro_accounts_are_unlimited(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions
) -> None:
    await make_pro(session_factory)

    for i in range(6):
        await create(api_client, auth, name=f"R{i}")

    body = await listing(api_client, auth)
    assert len(body["items"]) == 6
    assert body["routine_limit"] is None


# --- update -----------------------------------------------------------------------------


async def test_patch_fields_bumps_the_version(api_client: AsyncClient, auth: Headers) -> None:
    routine = await create(api_client, auth)
    path = f"/v1/routines/{routine['id']}"

    renamed = await api_client.patch(path, headers=auth, json={"name": " Push  A ", "notes": ""})
    unchanged = await api_client.patch(path, headers=auth, json={"name": "Push A"})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Push A"
    assert renamed.json()["notes"] == ""
    assert renamed.json()["version"] == 2
    assert renamed.json()["exercises"] == routine["exercises"]
    assert unchanged.json()["version"] == 2


async def test_patch_exercises_replaces_the_list(api_client: AsyncClient, auth: Headers) -> None:
    routine = await create(api_client, auth)
    path = f"/v1/routines/{routine['id']}"
    new_list = [
        {"exercise_id": PULLUP, "sets": [{"target_reps": 10}, {"target_reps": 10}]},
        {"exercise_id": BENCH, "sets": [{"target_weight_kg": 85, "target_reps": 6}]},
    ]

    replaced = await api_client.patch(path, headers=auth, json={"exercises": new_list})
    resent = await api_client.patch(path, headers=auth, json={"exercises": new_list})
    fetched = await api_client.get(path, headers=auth)

    assert replaced.status_code == 200, replaced.text
    assert [e["exercise_id"] for e in replaced.json()["exercises"]] == [PULLUP, BENCH]
    assert [len(e["sets"]) for e in replaced.json()["exercises"]] == [2, 1]
    assert replaced.json()["version"] == 2
    # Same content again is not a change.
    assert resent.json()["version"] == 2
    assert fetched.json() == resent.json()


async def test_patch_can_empty_the_routine(api_client: AsyncClient, auth: Headers) -> None:
    routine = await create(api_client, auth)

    response = await api_client.patch(
        f"/v1/routines/{routine['id']}", headers=auth, json={"exercises": []}
    )

    assert response.json()["exercises"] == []


async def test_a_deleted_custom_exercise_can_stay_but_not_be_added(
    api_client: AsyncClient, auth: Headers
) -> None:
    custom_id = await create_custom_exercise(api_client, auth, "Old Lift")
    old = {"exercise_id": custom_id, "sets": [{"target_reps": 5}]}
    keeps = await create(api_client, auth, exercises=[old])
    adds = await create(api_client, auth, exercises=[])
    await api_client.delete(f"/v1/exercises/{custom_id}", headers=auth)

    # The routine still reads, with the exercise's name.
    fetched = await api_client.get(f"/v1/routines/{keeps['id']}", headers=auth)
    assert fetched.json()["exercises"][0]["exercise_name"] == "Old Lift"

    edit = [old, {"exercise_id": BENCH, "sets": []}]
    kept = await api_client.patch(
        f"/v1/routines/{keeps['id']}", headers=auth, json={"exercises": edit}
    )
    added = await api_client.patch(
        f"/v1/routines/{adds['id']}", headers=auth, json={"exercises": [old]}
    )

    assert kept.status_code == 200, kept.text
    assert_invalid(added, ["body", "exercises", 0, "exercise_id"])


@pytest.mark.parametrize("field", ["name", "notes", "exercises"])
async def test_patch_rejects_null(api_client: AsyncClient, auth: Headers, field: str) -> None:
    routine = await create(api_client, auth)

    response = await api_client.patch(
        f"/v1/routines/{routine['id']}", headers=auth, json={field: None}
    )

    assert response.status_code == 422


async def test_moving_into_a_folder_appends_it(api_client: AsyncClient, auth: Headers) -> None:
    folder = await create_folder(api_client, auth, "Upper")
    first = await create(api_client, auth, name="In folder", folder_id=folder["id"])
    loose = await create(api_client, auth, name="Loose")

    moved = await api_client.patch(
        f"/v1/routines/{loose['id']}", headers=auth, json={"folder_id": folder["id"]}
    )
    back = await api_client.patch(
        f"/v1/routines/{first['id']}", headers=auth, json={"folder_id": None}
    )

    assert first["position"] == 0
    assert (moved.json()["folder_id"], moved.json()["position"]) == (folder["id"], 1)
    assert (back.json()["folder_id"], back.json()["position"]) == (None, 0)
    assert back.json()["version"] == 2


async def test_unknown_or_foreign_folder_is_rejected(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    theirs = await create_folder(api_client, other_auth, "Theirs")

    for folder_id in (MISSING, theirs["id"]):
        response = await api_client.post(
            "/v1/routines", headers=auth, json=push_day(folder_id=folder_id)
        )
        assert_invalid(response, ["body", "folder_id"])


# --- delete and duplicate ---------------------------------------------------------------


async def test_delete_hides_the_routine(api_client: AsyncClient, auth: Headers) -> None:
    routine = await create(api_client, auth)
    path = f"/v1/routines/{routine['id']}"

    deleted = await api_client.delete(path, headers=auth)
    again = await api_client.delete(path, headers=auth)

    assert deleted.status_code == 204
    assert again.status_code == 404
    assert (await api_client.get(path, headers=auth)).status_code == 404
    assert (await listing(api_client, auth))["items"] == []


async def test_duplicate_copies_everything(api_client: AsyncClient, auth: Headers) -> None:
    folder = await create_folder(api_client, auth, "Upper")
    routine = await create(api_client, auth, folder_id=folder["id"])

    copy = await api_client.post(f"/v1/routines/{routine['id']}/duplicate", headers=auth)
    named_id = str(uuid.uuid4())
    named = await api_client.post(
        f"/v1/routines/{routine['id']}/duplicate",
        headers=auth,
        json={"id": named_id, "name": "Push B"},
    )

    assert copy.status_code == 201, copy.text
    body = copy.json()
    assert body["id"] != routine["id"]
    assert body["name"] == "Push Day (Copy)"
    assert (body["folder_id"], body["position"]) == (folder["id"], 1)
    assert body["exercises"] == routine["exercises"]
    assert body["notes"] == routine["notes"]
    assert body["version"] == 1
    assert (named.json()["id"], named.json()["name"]) == (named_id, "Push B")

    clash = await api_client.post(
        f"/v1/routines/{routine['id']}/duplicate", headers=auth, json={"id": named_id}
    )
    assert clash.status_code == 409


# --- reorder ----------------------------------------------------------------------------


async def test_reorder_routines(api_client: AsyncClient, auth: Headers) -> None:
    a, b, c = [await create(api_client, auth, name=n, exercises=[]) for n in "ABC"]

    response = await api_client.post(
        "/v1/routines/reorder", headers=auth, json={"routine_ids": [c["id"], a["id"]]}
    )

    assert response.status_code == 200, response.text
    # Listed first, then the unlisted ones in their old order.
    assert order(response.json()["items"]) == [(None, 0, "C"), (None, 1, "A"), (None, 2, "B")]
    versions = {r["name"]: r["version"] for r in response.json()["items"]}
    assert versions == {"A": 2, "B": 2, "C": 2}
    assert response.json()["routine_limit"] == 4
    assert b["position"] == 1


async def test_reorder_moves_routines_into_a_folder(api_client: AsyncClient, auth: Headers) -> None:
    folder = await create_folder(api_client, auth, "Legs")
    inside = await create(api_client, auth, name="Inside", folder_id=folder["id"], exercises=[])
    loose = await create(api_client, auth, name="Loose", exercises=[])
    await create(api_client, auth, name="Stays", exercises=[])

    response = await api_client.post(
        "/v1/routines/reorder",
        headers=auth,
        json={"folder_id": folder["id"], "routine_ids": [loose["id"]]},
    )

    by_name = {r["name"]: (r["folder_id"], r["position"]) for r in response.json()["items"]}
    assert by_name["Loose"] == (folder["id"], 0)
    assert by_name["Inside"] == (folder["id"], 1)
    assert by_name["Stays"] == (None, 1)
    assert inside["version"] == 1


async def test_reorder_rejects_unknown_routines(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    mine = await create(api_client, auth, exercises=[])
    theirs = await create(api_client, other_auth, exercises=[])

    response = await api_client.post(
        "/v1/routines/reorder", headers=auth, json={"routine_ids": [mine["id"], theirs["id"]]}
    )

    assert_invalid(response, ["body", "routine_ids", 1])


# --- folders ----------------------------------------------------------------------------


async def test_folder_crud(api_client: AsyncClient, auth: Headers, other_auth: Headers) -> None:
    upper = await create_folder(api_client, auth, "Upper")
    lower = await create_folder(api_client, auth, " Lower   body ")
    path = f"/v1/routine-folders/{upper['id']}"

    renamed = await api_client.patch(path, headers=auth, json={"name": "Push"})
    same = await api_client.patch(path, headers=auth, json={"name": "Push"})
    foreign = await api_client.patch(path, headers=other_auth, json={"name": "Nope"})
    listed = await api_client.get("/v1/routine-folders", headers=auth)

    assert (upper["position"], lower["position"]) == (0, 1)
    assert lower["name"] == "Lower body"
    assert (renamed.json()["name"], renamed.json()["version"]) == ("Push", 2)
    assert same.json()["version"] == 2
    assert foreign.status_code == 404
    assert [f["name"] for f in listed.json()] == ["Push", "Lower body"]
    assert (await api_client.get("/v1/routine-folders", headers=other_auth)).json() == []


async def test_folder_client_id_is_used_once(api_client: AsyncClient, auth: Headers) -> None:
    folder_id = str(uuid.uuid4())
    body = {"id": folder_id, "name": "Upper"}

    first = await api_client.post("/v1/routine-folders", headers=auth, json=body)
    again = await api_client.post("/v1/routine-folders", headers=auth, json=body)

    assert first.json()["id"] == folder_id
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "folder_exists"


async def test_deleting_a_folder_keeps_its_routines(api_client: AsyncClient, auth: Headers) -> None:
    folder = await create_folder(api_client, auth, "Upper")
    await create(api_client, auth, name="Loose", exercises=[])
    await create(api_client, auth, name="Push", folder_id=folder["id"], exercises=[])
    await create(api_client, auth, name="Pull", folder_id=folder["id"], exercises=[])
    path = f"/v1/routine-folders/{folder['id']}"

    deleted = await api_client.delete(path, headers=auth)
    again = await api_client.delete(path, headers=auth)

    assert deleted.status_code == 204
    assert again.status_code == 404
    assert (await api_client.get("/v1/routine-folders", headers=auth)).json() == []
    items = (await listing(api_client, auth))["items"]
    assert order(items) == [(None, 0, "Loose"), (None, 1, "Push"), (None, 2, "Pull")]
    assert [r["version"] for r in items] == [1, 2, 2]


async def test_reorder_folders(api_client: AsyncClient, auth: Headers) -> None:
    a, b, c = [await create_folder(api_client, auth, n) for n in "ABC"]

    response = await api_client.post(
        "/v1/routine-folders/reorder", headers=auth, json={"folder_ids": [c["id"]]}
    )
    unknown = await api_client.post(
        "/v1/routine-folders/reorder", headers=auth, json={"folder_ids": [MISSING]}
    )

    assert response.status_code == 200
    assert [(f["name"], f["position"]) for f in response.json()] == [("C", 0), ("A", 1), ("B", 2)]
    assert [f["version"] for f in response.json()] == [2, 2, 2]
    assert_invalid(unknown, ["body", "folder_ids", 0])
    assert a["position"] == 0
    assert b["position"] == 1
