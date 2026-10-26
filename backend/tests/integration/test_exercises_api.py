import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from httpx import AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.cache.redis import get_redis
from app.db.models import Exercise
from app.services import exercises as exercise_service
from app.services.exercises import LIBRARY_VERSION_KEY, bust_library_cache
from app.services.library_seed import LibrarySeed, library_id, load_library
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Sessions = async_sessionmaker[AsyncSession]
Headers = dict[str, str]

BENCH = str(library_id("exercise", "bench-press-barbell"))
LIBRARY: LibrarySeed = load_library()


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client))


@pytest.fixture
async def other_auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client, email="other@example.com"))


def custom_body(**overrides: Any) -> dict[str, Any]:
    return {
        "name": "Landmine Thing",
        "type": "weight_reps",
        "equipment": "barbell",
        "primary_muscle": "chest",
        "secondary_muscles": ["triceps"],
        "instructions": ["Do the thing."],
        **overrides,
    }


async def names(client: AsyncClient, auth: Headers, **params: Any) -> list[str]:
    response = await client.get("/v1/exercises", headers=auth, params={"limit": 500, **params})
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()["items"]]


async def create(client: AsyncClient, auth: Headers, **overrides: Any) -> dict[str, Any]:
    response = await client.post("/v1/exercises", headers=auth, json=custom_body(**overrides))
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


# --- auth -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/exercises"),
        ("GET", f"/v1/exercises/{BENCH}"),
        ("POST", "/v1/exercises"),
        ("PATCH", f"/v1/exercises/{BENCH}"),
        ("DELETE", f"/v1/exercises/{BENCH}"),
        ("POST", f"/v1/exercises/{BENCH}/duplicate"),
        ("GET", "/v1/muscles"),
        ("GET", "/v1/equipment"),
    ],
)
async def test_everything_requires_auth(api_client: AsyncClient, method: str, path: str) -> None:
    response = await api_client.request(method, path)

    assert response.status_code == 401


# --- muscles and equipment --------------------------------------------------------------


async def test_muscles_and_equipment(api_client: AsyncClient, auth: Headers) -> None:
    muscles = await api_client.get("/v1/muscles", headers=auth)
    equipment = await api_client.get("/v1/equipment", headers=auth)

    assert muscles.status_code == equipment.status_code == 200
    assert len(muscles.json()) == 20
    chest = next(m for m in muscles.json() if m["slug"] == "chest")
    assert chest == {
        "id": str(library_id("muscle", "chest")),
        "slug": "chest",
        "name": "Chest",
        "body_map_key": "chest",
    }
    by_slug = {e["slug"]: e for e in equipment.json()}
    assert len(by_slug) == 14
    assert by_slug["barbell"]["increment_kg"] == 2.5
    assert by_slug["bodyweight"]["increment_kg"] is None


async def test_muscles_revalidate_with_etag(api_client: AsyncClient, auth: Headers) -> None:
    first = await api_client.get("/v1/muscles", headers=auth)
    again = await api_client.get(
        "/v1/muscles", headers={**auth, "If-None-Match": first.headers["ETag"]}
    )
    equipment = await api_client.get(
        "/v1/equipment", headers={**auth, "If-None-Match": first.headers["ETag"]}
    )

    assert again.status_code == 304
    assert again.content == b""
    assert equipment.status_code == 200
    assert first.headers["Cache-Control"] == "private, no-cache"

    equipment_again = await api_client.get(
        "/v1/equipment", headers={**auth, "If-None-Match": equipment.headers["ETag"]}
    )
    assert equipment_again.status_code == 304


# --- listing ----------------------------------------------------------------------------


async def test_default_page_is_alphabetical_with_a_cursor(
    api_client: AsyncClient, auth: Headers
) -> None:
    response = await api_client.get("/v1/exercises", headers=auth)

    body = response.json()
    page = [item["name"] for item in body["items"]]
    assert len(page) == 50
    assert page == sorted(page, key=str.casefold)
    assert body["next_cursor"]


async def test_walking_pages_returns_the_whole_library_once(
    api_client: AsyncClient, auth: Headers
) -> None:
    seen: list[str] = []
    cursor = None
    while True:
        params: dict[str, Any] = {"limit": 100} | ({"cursor": cursor} if cursor else {})
        body = (await api_client.get("/v1/exercises", headers=auth, params=params)).json()
        seen += [item["id"] for item in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert len(seen) == len(set(seen)) == len(LIBRARY.exercises)
    assert seen == [
        item["id"]
        for item in (
            await api_client.get("/v1/exercises", headers=auth, params={"limit": 500})
        ).json()["items"]
    ]


async def test_item_shape(api_client: AsyncClient, auth: Headers) -> None:
    body = (await api_client.get("/v1/exercises", headers=auth, params={"limit": 500})).json()
    bench = next(item for item in body["items"] if item["id"] == BENCH)

    assert bench["name"] == "Bench Press (Barbell)"
    assert bench["type"] == "weight_reps"
    assert bench["equipment"] == "barbell"
    assert bench["primary_muscle"] == "chest"
    assert bench["secondary_muscles"] == ["front_delts", "triceps"]
    assert 3 <= len(bench["instructions"]) <= 5
    assert bench["is_custom"] is False
    assert bench["is_archived"] is False
    assert bench["media_video_url"] is None


async def test_search_bench(api_client: AsyncClient, auth: Headers) -> None:
    found = await names(api_client, auth, q="bench")

    assert "Bench Press (Barbell)" in found
    assert found[0].lower().startswith("bench")
    assert all("bench" in name.lower() for name in found)


async def test_search_tolerates_typos(api_client: AsyncClient, auth: Headers) -> None:
    found = await names(api_client, auth, q="bnch press")

    assert "Bench Press (Barbell)" in found[:10]


async def test_search_expands_aliases(api_client: AsyncClient, auth: Headers) -> None:
    found = await names(api_client, auth, q="db bench")

    assert "Bench Press (Dumbbell)" in found[:5]
    assert "Bench Press (Barbell)" not in found[:5]


async def test_search_treats_wildcards_literally(api_client: AsyncClient, auth: Headers) -> None:
    assert await names(api_client, auth, q="100%") == []
    assert await names(api_client, auth, q="_") == []


async def test_filter_by_muscle_and_equipment(api_client: AsyncClient, auth: Headers) -> None:
    response = await api_client.get(
        "/v1/exercises",
        headers=auth,
        params={"muscle": ["chest", "triceps"], "equipment": "dumbbell", "limit": 500},
    )

    items = response.json()["items"]
    assert items
    assert {item["primary_muscle"] for item in items} == {"chest", "triceps"}
    assert {item["equipment"] for item in items} == {"dumbbell"}


async def test_search_and_filter_combine(api_client: AsyncClient, auth: Headers) -> None:
    found = await names(api_client, auth, q="press", equipment="machine", muscle="chest")

    assert "Chest Press (Machine)" in found
    assert "Bench Press (Barbell)" not in found


async def test_archived_exercises_leave_the_list_but_keep_their_page(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions, fake_redis: FakeAsyncRedis
) -> None:
    async with session_factory() as session:
        await session.execute(
            update(Exercise)
            .where(Exercise.id == BENCH)
            .values(is_archived=True, updated_at=func.clock_timestamp())
        )
        await session.commit()
    await bust_library_cache(fake_redis)

    assert "Bench Press (Barbell)" not in await names(api_client, auth, q="bench")
    detail = await api_client.get(f"/v1/exercises/{BENCH}", headers=auth)
    assert detail.status_code == 200
    assert detail.json()["is_archived"] is True


async def test_invalid_cursor(api_client: AsyncClient, auth: Headers) -> None:
    response = await api_client.get("/v1/exercises", headers=auth, params={"cursor": "nope"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_cursor"


async def test_limit_bounds(api_client: AsyncClient, auth: Headers) -> None:
    for limit in (0, 501):
        response = await api_client.get("/v1/exercises", headers=auth, params={"limit": limit})
        assert response.status_code == 422


# --- caching and etags ------------------------------------------------------------------


async def test_list_etag_and_304(api_client: AsyncClient, auth: Headers) -> None:
    first = await api_client.get("/v1/exercises", headers=auth, params={"q": "bench"})
    etag = first.headers["ETag"]

    same = await api_client.get(
        "/v1/exercises", headers={**auth, "If-None-Match": etag}, params={"q": "bench"}
    )
    other_query = await api_client.get(
        "/v1/exercises", headers={**auth, "If-None-Match": etag}, params={"q": "squat"}
    )

    assert same.status_code == 304
    assert same.headers["ETag"] == etag
    assert other_query.status_code == 200


async def test_creating_a_custom_exercise_changes_the_etag(
    api_client: AsyncClient, auth: Headers
) -> None:
    etag = (await api_client.get("/v1/exercises", headers=auth)).headers["ETag"]
    await create(api_client, auth, name="Aardvark Press")

    response = await api_client.get("/v1/exercises", headers={**auth, "If-None-Match": etag})

    assert response.status_code == 200
    assert response.json()["items"][0]["name"] == "Aardvark Press"
    assert response.headers["ETag"] != etag


async def test_library_list_is_served_from_the_cache_until_busted(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions, fake_redis: FakeAsyncRedis
) -> None:
    await names(api_client, auth)
    version = await fake_redis.get(LIBRARY_VERSION_KEY)
    assert await fake_redis.exists(f"exlib:{version}:all")

    # A change behind the API's back is invisible while the cached version holds...
    async with session_factory() as session:
        await session.execute(
            update(Exercise)
            .where(Exercise.id == BENCH)
            # now() is the test transaction's start time; clock_timestamp() really moves.
            .values(name="Renamed Bench", updated_at=func.clock_timestamp())
        )
        await session.commit()
    assert "Renamed Bench" not in await names(api_client, auth)

    # ...and appears once the version is recomputed (the seed command does this).
    await bust_library_cache(fake_redis)
    assert "Renamed Bench" in await names(api_client, auth)
    assert await fake_redis.get(LIBRARY_VERSION_KEY) != version


class DownRedis:
    async def get(self, *_: object, **__: object) -> None:
        raise RedisConnectionError("down")

    async def set(self, *_: object, **__: object) -> None:
        raise RedisConnectionError("down")


@pytest.fixture
def redis_down(app: FastAPI) -> Iterator[None]:
    async def broken() -> DownRedis:
        return DownRedis()

    app.dependency_overrides[get_redis] = broken
    yield
    app.dependency_overrides.pop(get_redis, None)


async def test_listing_works_without_redis(
    api_client: AsyncClient, auth: Headers, redis_down: None
) -> None:
    assert "Bench Press (Barbell)" in await names(api_client, auth, q="bench")


# --- detail -----------------------------------------------------------------------------


async def test_get_library_exercise(api_client: AsyncClient, auth: Headers) -> None:
    response = await api_client.get(f"/v1/exercises/{BENCH}", headers=auth)

    assert response.status_code == 200
    body = response.json()
    assert (body["primary_muscle"], body["secondary_muscles"]) == (
        "chest",
        ["front_delts", "triceps"],
    )


async def test_unknown_exercise_is_404(api_client: AsyncClient, auth: Headers) -> None:
    response = await api_client.get(f"/v1/exercises/{uuid.uuid4()}", headers=auth)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --- custom exercises -------------------------------------------------------------------


async def test_create_custom_exercise(api_client: AsyncClient, auth: Headers) -> None:
    client_id = str(uuid.uuid4())

    body = await create(
        api_client, auth, id=client_id, secondary_muscles=["triceps", "front_delts"]
    )

    assert body["id"] == client_id
    assert body["is_custom"] is True
    assert body["version"] == 1
    assert body["secondary_muscles"] == ["front_delts", "triceps"]
    assert body["media_video_url"] is None
    fetched = await api_client.get(f"/v1/exercises/{client_id}", headers=auth)
    assert fetched.json() == body


async def test_custom_exercises_are_private(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    mine = await create(api_client, auth, name="Secret Squat")

    assert "Secret Squat" in await names(api_client, auth, q="secret")
    assert await names(api_client, other_auth, q="secret") == []
    response = await api_client.get(f"/v1/exercises/{mine['id']}", headers=other_auth)
    assert response.status_code == 404


async def test_custom_exercises_rank_with_the_library(
    api_client: AsyncClient, auth: Headers
) -> None:
    await create(api_client, auth, name="Bench Press (Band Resisted)")

    found = await names(api_client, auth, q="bench press")

    assert "Bench Press (Band Resisted)" in found[:3]


async def test_reusing_an_id_is_a_conflict(api_client: AsyncClient, auth: Headers) -> None:
    body = await create(api_client, auth)

    again = await api_client.post("/v1/exercises", headers=auth, json=custom_body(id=body["id"]))
    library = await api_client.post("/v1/exercises", headers=auth, json=custom_body(id=BENCH))

    assert again.status_code == library.status_code == 409
    assert again.json()["error"]["code"] == "exercise_exists"


@pytest.mark.parametrize(
    ("overrides", "loc"),
    [
        ({"equipment": "sled"}, ["body", "equipment"]),
        ({"primary_muscle": "wings"}, ["body", "primary_muscle"]),
        ({"secondary_muscles": ["wings"]}, ["body", "secondary_muscles"]),
        ({"secondary_muscles": ["chest"]}, ["body", "secondary_muscles"]),
        ({"secondary_muscles": ["triceps", "triceps"]}, ["body", "secondary_muscles"]),
        ({"type": "cardio"}, ["body", "type"]),
    ],
)
async def test_create_validation(
    api_client: AsyncClient, auth: Headers, overrides: dict[str, Any], loc: list[str]
) -> None:
    response = await api_client.post("/v1/exercises", headers=auth, json=custom_body(**overrides))

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["loc"] == loc


async def test_update_custom_exercise(api_client: AsyncClient, auth: Headers) -> None:
    body = await create(api_client, auth)

    response = await api_client.patch(
        f"/v1/exercises/{body['id']}",
        headers=auth,
        json={
            "name": "Renamed",
            "type": "weight_reps",
            "equipment": "dumbbell",
            "primary_muscle": "triceps",
            "secondary_muscles": ["chest"],
            "instructions": ["New step."],
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == "Renamed"
    assert updated["equipment"] == "dumbbell"
    assert (updated["primary_muscle"], updated["secondary_muscles"]) == ("triceps", ["chest"])
    assert updated["instructions"] == ["New step."]
    assert updated["version"] == 2
    fetched = await api_client.get(f"/v1/exercises/{body['id']}", headers=auth)
    assert fetched.json() == updated


async def test_noop_update_keeps_the_version(api_client: AsyncClient, auth: Headers) -> None:
    body = await create(api_client, auth)

    response = await api_client.patch(
        f"/v1/exercises/{body['id']}", headers=auth, json={"name": body["name"]}
    )

    assert response.json()["version"] == 1


async def test_type_is_immutable(api_client: AsyncClient, auth: Headers) -> None:
    body = await create(api_client, auth)

    response = await api_client.patch(
        f"/v1/exercises/{body['id']}", headers=auth, json={"type": "duration"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "exercise_type_immutable"
    assert response.json()["error"]["details"] == {"type": "weight_reps"}


async def test_update_checks_the_merged_muscles(api_client: AsyncClient, auth: Headers) -> None:
    body = await create(api_client, auth, secondary_muscles=["triceps"])

    response = await api_client.patch(
        f"/v1/exercises/{body['id']}", headers=auth, json={"primary_muscle": "triceps"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "secondary_muscles"]


async def test_library_exercises_are_read_only(api_client: AsyncClient, auth: Headers) -> None:
    patched = await api_client.patch(f"/v1/exercises/{BENCH}", headers=auth, json={"name": "x"})
    deleted = await api_client.delete(f"/v1/exercises/{BENCH}", headers=auth)

    assert patched.status_code == deleted.status_code == 403
    assert patched.json()["error"]["code"] == "library_exercise_read_only"


async def test_someone_elses_exercise_is_404(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    body = await create(api_client, auth)

    patched = await api_client.patch(
        f"/v1/exercises/{body['id']}", headers=other_auth, json={"name": "mine now"}
    )
    deleted = await api_client.delete(f"/v1/exercises/{body['id']}", headers=other_auth)
    copied = await api_client.post(f"/v1/exercises/{body['id']}/duplicate", headers=other_auth)

    assert patched.status_code == deleted.status_code == copied.status_code == 404


async def test_delete_is_soft_and_final(api_client: AsyncClient, auth: Headers) -> None:
    body = await create(api_client, auth, name="Doomed Row")

    first = await api_client.delete(f"/v1/exercises/{body['id']}", headers=auth)
    second = await api_client.delete(f"/v1/exercises/{body['id']}", headers=auth)

    assert first.status_code == 204
    assert second.status_code == 404
    assert (await api_client.get(f"/v1/exercises/{body['id']}", headers=auth)).status_code == 404
    assert await names(api_client, auth, q="doomed") == []


async def test_duplicate_a_library_exercise(api_client: AsyncClient, auth: Headers) -> None:
    response = await api_client.post(f"/v1/exercises/{BENCH}/duplicate", headers=auth)

    assert response.status_code == 201
    copy = response.json()
    assert copy["id"] != BENCH
    assert copy["name"] == "Bench Press (Barbell) (Copy)"
    assert copy["is_custom"] is True
    assert copy["type"] == "weight_reps"
    assert copy["secondary_muscles"] == ["front_delts", "triceps"]
    assert copy["version"] == 1


async def test_duplicate_with_a_name_and_id(api_client: AsyncClient, auth: Headers) -> None:
    mine = await create(api_client, auth)
    client_id = str(uuid.uuid4())

    response = await api_client.post(
        f"/v1/exercises/{mine['id']}/duplicate",
        headers=auth,
        json={"id": client_id, "name": "  Second   Version "},
    )

    assert response.status_code == 201
    assert response.json()["id"] == client_id
    assert response.json()["name"] == "Second Version"


async def test_id_race_is_caught_by_the_primary_key(
    api_client: AsyncClient, auth: Headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    body = await create(api_client, auth)

    async def looks_free(*_: object) -> None:
        return None

    monkeypatch.setattr(exercise_service, "_ensure_id_free", looks_free)

    response = await api_client.post("/v1/exercises", headers=auth, json=custom_body(id=body["id"]))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "exercise_exists"
