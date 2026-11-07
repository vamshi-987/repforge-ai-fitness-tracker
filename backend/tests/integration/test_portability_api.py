"""Export, CSV import and closing an account."""

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.db.models import (
    Exercise,
    Food,
    PhotoAnalysis,
    ProgressPhoto,
    PushToken,
    RefreshToken,
    Routine,
    User,
    Workout,
)
from app.services import account
from app.services.library_seed import library_id
from app.services.portability import CSV_COLUMNS, safe_cell
from app.services.storage import S3PhotoStore, StorageError
from tests.integration.helpers import TEST_PASSWORD, bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Sessions = async_sessionmaker[AsyncSession]
Headers = dict[str, str]

EMAIL = "lifter@example.com"
BENCH = str(library_id("exercise", "bench-press-barbell"))
SQUAT = str(library_id("exercise", "squat-barbell"))


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client, EMAIL))


async def workout(
    client: AsyncClient, auth: Headers, title: str = "Push", notes: str = "", days_ago: float = 2
) -> str:
    workout_id = str(uuid.uuid4())
    ended = datetime.now(UTC) - timedelta(days=days_ago)
    response = await client.put(
        f"/v1/workouts/{workout_id}",
        headers=auth,
        json={
            "title": title,
            "notes": notes,
            "started_at": (ended - timedelta(hours=1)).isoformat(),
            "ended_at": ended.isoformat(),
            "exercises": [
                {
                    "exercise_id": BENCH,
                    "sets": [
                        {"set_type": "warmup", "weight_kg": 20, "reps": 10},
                        {"weight_kg": 60, "reps": 8, "rpe": 8},
                    ],
                },
                {"exercise_id": SQUAT, "sets": [{"weight_kg": 100, "reps": 5}]},
            ],
        },
    )
    assert response.status_code in (200, 201), response.text
    return workout_id


async def csv_of(client: AsyncClient, auth: Headers) -> str:
    response = await client.get("/v1/me/export/workouts.csv", headers=auth)
    assert response.status_code == 200, response.text
    return response.text


async def upload(client: AsyncClient, auth: Headers, text: str | bytes) -> Any:
    data = text.encode() if isinstance(text, str) else text
    return await client.post(
        "/v1/me/import/workouts",
        headers=auth,
        files={"file": ("workouts.csv", data, "text/csv")},
    )


def sheet(*rows: dict[str, Any]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, CSV_COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def row(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "Imported",
        "started_at": "2026-01-05T08:00:00+00:00",
        "ended_at": "2026-01-05T09:00:00+00:00",
        "notes": "",
        "exercise": "Bench Press (Barbell)",
        "set_type": "normal",
        "weight_kg": 60,
        "reps": 8,
        "duration_s": "",
        "distance_m": "",
        "rpe": "",
        **overrides,
    }


# --- export -------------------------------------------------------------------------------


async def test_the_export_holds_what_the_user_stored(
    api_client: AsyncClient, auth: Headers
) -> None:
    await workout(api_client, auth)
    await api_client.post(
        "/v1/body/weights",
        headers=auth,
        json={"measured_at": "2026-01-05T07:00:00+00:00", "weight_kg": 80},
    )
    await api_client.post("/v1/water", headers=auth, json={"amount_ml": 500})
    await api_client.post(
        "/v1/foods",
        headers=auth,
        json={
            "name": "Mom's dal",
            "kcal_100g": 120,
            "protein_100g": 7,
            "carbs_100g": 15,
            "fat_100g": 3,
        },
    )

    response = await api_client.get("/v1/me/export", headers=auth)

    assert response.status_code == 200, response.text
    assert "attachment" in response.headers["content-disposition"]
    body = response.json()
    assert body["account"]["email"] == EMAIL
    assert len(body["workouts"]) == 1
    assert len(body["workouts"][0]["exercises"]) == 2
    assert [w["weight_kg"] for w in body["body_weights"]] == [80]
    assert [w["amount_ml"] for w in body["water_logs"]] == [500]
    assert [f["name"] for f in body["custom_foods"]] == ["Mom's dal"]
    assert body["personal_records"]


async def test_the_export_holds_no_secrets_or_other_peoples_data(
    api_client: AsyncClient, auth: Headers
) -> None:
    other = bearer(await register_user(api_client, "other@example.com"))
    await workout(api_client, other, title="Not yours")

    response = await api_client.get("/v1/me/export", headers=auth)

    assert "password_hash" not in response.text
    assert "argon2" not in response.text
    assert "token_hash" not in response.text
    assert "Not yours" not in response.text
    assert "other@example.com" not in response.text


async def test_the_export_leaves_out_deleted_rows(api_client: AsyncClient, auth: Headers) -> None:
    created = await api_client.post(
        "/v1/body/weights",
        headers=auth,
        json={"measured_at": "2026-01-05T07:00:00+00:00", "weight_kg": 80},
    )
    await api_client.delete(f"/v1/body/weights/{created.json()['id']}", headers=auth)

    assert (await api_client.get("/v1/me/export", headers=auth)).json()["body_weights"] == []


async def test_the_csv_has_one_row_per_set(api_client: AsyncClient, auth: Headers) -> None:
    await workout(api_client, auth)

    rows = list(csv.DictReader(io.StringIO(await csv_of(api_client, auth))))

    assert [(r["exercise"], r["set_type"], r["weight_kg"], r["reps"]) for r in rows] == [
        ("Bench Press (Barbell)", "warmup", "20.0", "10"),
        ("Bench Press (Barbell)", "normal", "60.0", "8"),
        ("Squat (Barbell)", "normal", "100.0", "5"),
    ]
    assert rows[1]["rpe"] == "8.0"


@pytest.mark.parametrize(
    ("cell", "safe"),
    [("=HYPERLINK()", "'=HYPERLINK()"), ("@cmd", "'@cmd"), ("-1", "'-1"), ("Push", "Push")],
)
def test_cells_cant_run_as_formulas(cell: str, safe: str) -> None:
    assert safe_cell(cell) == safe


# --- import -------------------------------------------------------------------------------


async def test_an_export_comes_back_on_another_account(
    api_client: AsyncClient, auth: Headers
) -> None:
    await workout(api_client, auth, title="=Push", notes="Felt good")
    text = await csv_of(api_client, auth)
    other = bearer(await register_user(api_client, "other@example.com"))

    response = await upload(api_client, other, text)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "imported": 1,
        "duplicates": 0,
        "unknown_exercises": [],
        "invalid": [],
    }
    (item,) = (await api_client.get("/v1/workouts", headers=other)).json()["items"]
    assert item["title"] == "=Push"
    assert item["visibility"] == "private"
    full = (await api_client.get(f"/v1/workouts/{item['id']}", headers=other)).json()
    assert full["notes"] == "Felt good"
    assert [len(e["sets"]) for e in full["exercises"]] == [2, 1]
    assert full["total_sets"] > 0


async def test_importing_twice_adds_nothing(api_client: AsyncClient, auth: Headers) -> None:
    await workout(api_client, auth)
    text = await csv_of(api_client, auth)

    response = await upload(api_client, auth, text)

    assert response.json()["imported"] == 0
    assert response.json()["duplicates"] == 1


async def test_rows_group_into_workouts_and_exercises(
    api_client: AsyncClient, auth: Headers
) -> None:
    later = {
        "title": "Later",
        "started_at": "2026-01-07T08:00:00+00:00",
        "ended_at": "2026-01-07T09:00:00+00:00",
    }
    text = sheet(row(), row(reps=7), row(exercise="squat (barbell)"), row(**later))

    report = (await upload(api_client, auth, text)).json()

    assert report["imported"] == 2
    items = (await api_client.get("/v1/workouts", headers=auth)).json()["items"]
    assert {w["title"] for w in items} == {"Imported", "Later"}
    imported = next(w for w in items if w["title"] == "Imported")
    full = (await api_client.get(f"/v1/workouts/{imported['id']}", headers=auth)).json()
    assert [len(e["sets"]) for e in full["exercises"]] == [2, 1]


async def test_a_custom_exercise_name_resolves_to_the_users_own(
    api_client: AsyncClient, auth: Headers
) -> None:
    created = await api_client.post(
        "/v1/exercises",
        headers=auth,
        json={
            "name": "My Press",
            "type": "weight_reps",
            "equipment": "barbell",
            "primary_muscle": "chest",
        },
    )
    assert created.status_code == 201, created.text

    report = (await upload(api_client, auth, sheet(row(exercise="my press")))).json()

    assert report["imported"] == 1


async def test_unknown_exercises_skip_their_workout_and_are_named(
    api_client: AsyncClient, auth: Headers
) -> None:
    text = sheet(row(exercise="Mystery Lift"), row(exercise="Mystery Lift", reps=7))

    report = (await upload(api_client, auth, text)).json()

    assert report["imported"] == 0
    assert report["unknown_exercises"] == ["Mystery Lift"]


@pytest.mark.parametrize(
    "bad",
    [
        {"weight_kg": "heavy"},
        {"started_at": "yesterday"},
        {"set_type": "mega"},
        {"ended_at": "2020-01-01T00:00:00+00:00"},
    ],
)
async def test_workouts_that_make_no_sense_are_listed_not_fatal(
    api_client: AsyncClient, auth: Headers, bad: dict[str, Any]
) -> None:
    good = {"title": "Good", "started_at": "2026-02-05T08:00:00+00:00"}
    good["ended_at"] = "2026-02-05T09:00:00+00:00"

    report = (await upload(api_client, auth, sheet(row(**bad), row(**good)))).json()

    assert report["imported"] == 1
    assert report["invalid"] == ["Imported"]


async def test_a_file_from_excel_with_a_bom_works(api_client: AsyncClient, auth: Headers) -> None:
    report = (await upload(api_client, auth, b"\xef\xbb\xbf" + sheet(row()).encode())).json()

    assert report["imported"] == 1


@pytest.mark.parametrize("data", [b"just,some,columns\n1,2,3\n", b"\xff\xfe\x00bad", b""])
async def test_files_that_arent_this_format_are_refused(
    api_client: AsyncClient, auth: Headers, data: bytes
) -> None:
    assert (await upload(api_client, auth, data)).status_code == 422


async def test_huge_files_are_refused(api_client: AsyncClient, auth: Headers) -> None:
    assert (await upload(api_client, auth, b"x" * (5 * 1024 * 1024 + 1))).status_code == 422


# --- closing an account -------------------------------------------------------------------


class Objects:
    def __init__(self) -> None:
        self.removed: list[tuple[str, str]] = []
        self.fail = False

    async def remove(self, bucket: str, key: str) -> None:
        if self.fail:
            raise StorageError("down")
        self.removed.append((bucket, key))


async def close(api_client: AsyncClient, auth: Headers) -> Any:
    return await api_client.request("DELETE", "/v1/me", headers=auth, json={"confirm": "DELETE"})


async def test_closing_needs_the_typed_confirmation(api_client: AsyncClient, auth: Headers) -> None:
    for body in ({}, {"confirm": "delete"}):
        response = await api_client.request("DELETE", "/v1/me", headers=auth, json=body)
        assert response.status_code == 422

    assert (await api_client.get("/v1/me", headers=auth)).status_code == 200


async def test_a_closed_account_stops_working_at_once(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions
) -> None:
    await api_client.post(
        "/v1/push/tokens",
        headers=auth,
        json={"expo_token": "ExponentPushToken[x]", "platform": "ios"},
    )

    assert (await close(api_client, auth)).status_code == 204

    assert (await api_client.get("/v1/me", headers=auth)).status_code == 401
    login = await api_client.post(
        "/v1/auth/login", json={"email": EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 401
    async with session_factory() as session:
        assert list(await session.scalars(select(PushToken))) == []
        tokens = list(await session.scalars(select(RefreshToken)))
    assert tokens
    assert all(t.revoked_at is not None for t in tokens)


async def test_a_closed_account_leaves_other_peoples_feeds(
    api_client: AsyncClient, auth: Headers
) -> None:
    me = (await api_client.get("/v1/me", headers=auth)).json()
    fan = bearer(await register_user(api_client, "fan@example.com"))
    await api_client.post(f"/v1/users/{me['id']}/follow", headers=fan)
    workout_id = str(uuid.uuid4())
    ended = datetime.now(UTC) - timedelta(hours=1)
    await api_client.put(
        f"/v1/workouts/{workout_id}",
        headers=auth,
        json={
            "title": "Push",
            "visibility": "public",
            "started_at": (ended - timedelta(hours=1)).isoformat(),
            "ended_at": ended.isoformat(),
            "exercises": [{"exercise_id": BENCH, "sets": [{"weight_kg": 60, "reps": 8}]}],
        },
    )
    assert (await api_client.get("/v1/feed", headers=fan)).json()["items"]

    await close(api_client, auth)

    assert (await api_client.get("/v1/feed", headers=fan)).json()["items"] == []
    assert (await api_client.get(f"/v1/users/{me['username']}", headers=fan)).status_code == 404


async def full_account(api_client: AsyncClient, auth: Headers, session_factory: Sessions) -> str:
    """Data in every tricky table: custom rows held by RESTRICT keys, and stored photos."""
    me = (await api_client.get("/v1/me", headers=auth)).json()
    exercise = await api_client.post(
        "/v1/exercises",
        headers=auth,
        json={
            "name": "My Press",
            "type": "weight_reps",
            "equipment": "barbell",
            "primary_muscle": "chest",
        },
    )
    exercise_id = exercise.json()["id"]
    food = await api_client.post(
        "/v1/foods",
        headers=auth,
        json={"name": "Dal", "kcal_100g": 120, "protein_100g": 7, "carbs_100g": 15, "fat_100g": 3},
    )
    ended = datetime.now(UTC) - timedelta(days=1)
    await api_client.put(
        f"/v1/workouts/{uuid.uuid4()}",
        headers=auth,
        json={
            "title": "Mine",
            "started_at": (ended - timedelta(hours=1)).isoformat(),
            "ended_at": ended.isoformat(),
            "exercises": [{"exercise_id": exercise_id, "sets": [{"weight_kg": 60, "reps": 8}]}],
        },
    )
    routine = await api_client.post(
        "/v1/routines",
        headers=auth,
        json={"name": "R", "exercises": [{"exercise_id": exercise_id, "sets": [{}]}]},
    )
    assert routine.status_code == 201, routine.text
    meal = await api_client.post(
        "/v1/saved-meals",
        headers=auth,
        json={
            "name": "M",
            "items": [{"food_id": food.json()["id"], "quantity": 1, "unit": "g", "grams": 100}],
        },
    )
    assert meal.status_code == 201, meal.text
    user_id = uuid.UUID(me["id"])
    async with session_factory() as session:
        session.add(
            ProgressPhoto(
                user_id=user_id,
                object_key=f"{user_id}/p.jpg",
                taken_at=datetime.now(UTC),
            )
        )
        session.add(PhotoAnalysis(user_id=user_id, object_key=f"{user_id}/f.jpg"))
        await session.commit()
    user_id_text: str = me["id"]
    return user_id_text


async def test_the_daily_job_erases_a_closed_account_completely(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    test_settings: Settings,
) -> None:
    other = bearer(await register_user(api_client, "other@example.com"))
    await workout(api_client, other, title="Kept")
    await full_account(api_client, auth, session_factory)
    await close(api_client, auth)
    objects = Objects()
    later = datetime.now(UTC) + account.PURGE_AFTER + timedelta(minutes=1)

    async with session_factory() as session:
        erased = await account.purge_closed_accounts(session, test_settings, objects, later)
        users = list(await session.scalars(select(User.email)))
        counts = [
            await session.scalar(select(func.count()).select_from(model))
            for model in (Routine, ProgressPhoto, PhotoAnalysis)
        ]
        own_exercises = await session.scalar(
            select(func.count()).select_from(Exercise).where(Exercise.owner_user_id.isnot(None))
        )
        own_foods = await session.scalar(
            select(func.count()).select_from(Food).where(Food.owner_user_id.isnot(None))
        )
        workouts = list(await session.scalars(select(Workout.title)))

    assert erased == 1
    assert users == ["other@example.com"]
    assert counts == [0, 0, 0]
    assert (own_exercises, own_foods) == (0, 0)
    assert workouts == ["Kept"]
    assert {bucket for bucket, _ in objects.removed} == {"progress-photos", "food-photos"}
    assert len(objects.removed) == 2


async def test_the_job_waits_out_the_period(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions, test_settings: Settings
) -> None:
    await close(api_client, auth)

    async with session_factory() as session:
        erased = await account.purge_closed_accounts(
            session, test_settings, Objects(), datetime.now(UTC) + timedelta(days=27)
        )

    assert erased == 0


async def test_open_accounts_are_never_touched(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions, test_settings: Settings
) -> None:
    far = datetime.now(UTC) + timedelta(days=400)

    async with session_factory() as session:
        assert await account.purge_closed_accounts(session, test_settings, Objects(), far) == 0


async def test_storage_trouble_keeps_the_account_for_tomorrow(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    test_settings: Settings,
) -> None:
    await full_account(api_client, auth, session_factory)
    await close(api_client, auth)
    objects = Objects()
    objects.fail = True
    later = datetime.now(UTC) + account.PURGE_AFTER + timedelta(minutes=1)

    async with session_factory() as session:
        assert await account.purge_closed_accounts(session, test_settings, objects, later) == 0
        assert await session.scalar(select(User).where(User.email == EMAIL)) is not None

    objects.fail = False
    async with session_factory() as session:
        assert await account.purge_closed_accounts(session, test_settings, objects, later) == 1


async def test_the_s3_store_removes_objects(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(204)

    real = httpx.AsyncClient
    monkeypatch.setattr(
        "app.services.storage.httpx.AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )

    await S3PhotoStore(test_settings).remove("progress-photos", "u/a.jpg")

    assert calls[0].method == "DELETE"
    assert calls[0].url.path == "/progress-photos/u/a.jpg"
