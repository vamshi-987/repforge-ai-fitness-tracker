"""Food photos: upload, worker, draft. Claude is replayed; storage and the queue are in memory."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.client import AiClient, get_ai_client
from app.config import Settings
from app.db.models import AnalysisStatus, PhotoAnalysis, User
from app.routers.nutrition import get_photo_queue, get_photo_store
from app.services import food_photos
from app.services.storage import S3PhotoStore, StorageError
from tests.ai_replay import Replay, canned, fixture, replay_client
from tests.integration.helpers import bearer, register_user

pytestmark = pytest.mark.integration

Sessions = async_sessionmaker[AsyncSession]
Headers = dict[str, str]

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"0" * 64


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail = False

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        if self.fail:
            raise StorageError("down")
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        if self.fail:
            raise StorageError("down")
        return self.objects[key]


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
def queued() -> list[uuid.UUID]:
    return []


@pytest.fixture
def replay() -> Replay:
    return Replay()


@pytest.fixture
def ai(replay: Replay, test_settings: Settings) -> AiClient:
    return replay_client(replay, test_settings)


@pytest.fixture
async def auth(
    api_client: AsyncClient,
    app: FastAPI,
    store: MemoryStore,
    queued: list[uuid.UUID],
    ai: AiClient,
) -> AsyncIterator[Headers]:
    app.dependency_overrides[get_photo_store] = lambda: store
    app.dependency_overrides[get_photo_queue] = lambda: queued.append
    app.dependency_overrides[get_ai_client] = lambda: ai
    yield bearer(await register_user(api_client))


def upload(data: bytes = JPEG) -> dict[str, Any]:
    return {"files": {"file": ("meal.jpg", data, "image/jpeg")}}


async def start(api_client: AsyncClient, auth: Headers, data: bytes = JPEG) -> uuid.UUID:
    response = await api_client.post("/v1/nutrition/photo", headers=auth, **upload(data))
    assert response.status_code == 202, response.text
    return uuid.UUID(response.json()["analysis_id"])


async def custom_food(api_client: AsyncClient, auth: Headers, name: str) -> dict[str, Any]:
    body = {
        "name": name,
        "kcal_100g": 200,
        "protein_100g": 10,
        "carbs_100g": 25,
        "fat_100g": 6,
        "fiber_100g": 1,
    }
    response = await api_client.post("/v1/foods", json=body, headers=auth)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def test_a_photo_becomes_a_draft_with_database_numbers_where_a_food_matches(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    queued: list[uuid.UUID],
    replay: Replay,
    ai: AiClient,
) -> None:
    food = await custom_food(api_client, auth, "Chicken Biryani")
    replay.replies.append(fixture("food_photo"))

    analysis_id = await start(api_client, auth)

    assert queued == [analysis_id]
    pending = await api_client.get(f"/v1/nutrition/photo/{analysis_id}", headers=auth)
    assert pending.json()["status"] == "pending"

    async with session_factory() as session:
        await food_photos.process_analysis(session, ai, store, analysis_id)

    body = (await api_client.get(f"/v1/nutrition/photo/{analysis_id}", headers=auth)).json()
    assert body["status"] == "done"
    assert body["error"] is None
    assert body["draft"]["notes"].startswith("Portion estimated")
    matched, estimated = body["draft"]["items"]
    # 350 g of the database's food, not the model's 560 kcal.
    assert matched["food_id"] == food["id"]
    assert matched["name"] == "Chicken Biryani"
    assert (matched["grams"], matched["kcal"], matched["protein_g"]) == (350, 700, 35)
    assert matched["fiber_g"] == 3.5
    assert matched["confidence"] == 0.7
    # No match: the model's numbers, per 100 g so the draft can scale.
    assert estimated["food_id"] is None
    assert estimated["name"] == "cucumber raita"
    assert (estimated["kcal"], estimated["protein_g"], estimated["fat_g"]) == (60, 3, 3)
    assert estimated["per_100g"] == {
        "kcal": 60,
        "protein": 3,
        "carbs": 5,
        "fat": 3,
        "fiber": None,
    }

    image = replay.requests[0]["messages"][0]["content"][0]
    assert image["type"] == "image"
    assert image["source"]["media_type"] == "image/jpeg"


async def test_nothing_is_logged_until_the_user_confirms(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    replay: Replay,
    ai: AiClient,
) -> None:
    replay.replies.append(fixture("food_photo"))
    analysis_id = await start(api_client, auth)
    async with session_factory() as session:
        await food_photos.process_analysis(session, ai, store, analysis_id)

    day = await api_client.get("/v1/nutrition/day?date=2026-11-05", headers=auth)
    assert day.json()["totals"]["kcal"] == 0

    confirmed = await api_client.post(
        "/v1/food-logs",
        headers=auth,
        json={
            "log_date": "2026-11-05",
            "meal": "lunch",
            "name": "cucumber raita",
            "per_100g": {"kcal": 60, "protein": 3, "carbs": 5, "fat": 3},
            "quantity": 150,
            "unit": "g",
            "grams": 150,
            "source": "photo",
            "photo_analysis_id": str(analysis_id),
        },
    )
    assert confirmed.status_code == 201, confirmed.text
    assert confirmed.json()["kcal"] == 90
    assert confirmed.json()["photo_analysis_id"] == str(analysis_id)


async def test_a_photo_without_food_gives_an_empty_draft(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    replay: Replay,
    ai: AiClient,
) -> None:
    replay.replies.append(canned({"items": [], "notes": "no food detected"}))
    analysis_id = await start(api_client, auth, PNG)
    async with session_factory() as session:
        await food_photos.process_analysis(session, ai, store, analysis_id)

    body = (await api_client.get(f"/v1/nutrition/photo/{analysis_id}", headers=auth)).json()

    assert body["status"] == "done"
    assert body["draft"] == {"items": [], "notes": "no food detected"}
    assert replay.requests[0]["messages"][0]["content"][0]["source"]["media_type"] == "image/png"


async def test_estimates_stay_within_what_100_g_can_hold(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    replay: Replay,
    ai: AiClient,
) -> None:
    item = {
        "name": "ghee",
        "estimated_grams": 10,
        "kcal": 120,
        "protein_g": 0,
        "carbs_g": 0,
        "fat_g": 12,
        "confidence": 0.5,
        "match_query": "clarified butter drizzle",
    }
    replay.replies.append(canned({"items": [item], "notes": ""}))
    analysis_id = await start(api_client, auth, WEBP)
    async with session_factory() as session:
        await food_photos.process_analysis(session, ai, store, analysis_id)

    body = (await api_client.get(f"/v1/nutrition/photo/{analysis_id}", headers=auth)).json()

    assert body["draft"]["items"][0]["per_100g"]["kcal"] == 900
    assert body["draft"]["items"][0]["per_100g"]["fat"] == 100
    assert body["draft"]["items"][0]["kcal"] == 90


@pytest.mark.parametrize(
    ("replies", "error"),
    [
        ([canned("nonsense"), canned("nonsense")], "invalid_output"),
        ([500], "api_error"),
        ([canned("", "refusal")], "refused"),
    ],
)
async def test_a_failed_analysis_says_so(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    replay: Replay,
    ai: AiClient,
    replies: list[Any],
    error: str,
) -> None:
    replay.replies.extend(replies)
    analysis_id = await start(api_client, auth)
    async with session_factory() as session:
        await food_photos.process_analysis(session, ai, store, analysis_id)

    body = (await api_client.get(f"/v1/nutrition/photo/{analysis_id}", headers=auth)).json()

    assert (body["status"], body["error"], body["draft"]) == ("failed", error, None)


async def test_a_lost_photo_fails_the_analysis(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    ai: AiClient,
) -> None:
    analysis_id = await start(api_client, auth)
    store.fail = True
    async with session_factory() as session:
        await food_photos.process_analysis(session, ai, store, analysis_id)

    body = (await api_client.get(f"/v1/nutrition/photo/{analysis_id}", headers=auth)).json()

    assert body["error"] == "storage"


async def test_a_redelivered_task_changes_nothing(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    replay: Replay,
    ai: AiClient,
) -> None:
    replay.replies.append(fixture("food_photo"))
    analysis_id = await start(api_client, auth)
    async with session_factory() as session:
        await food_photos.process_analysis(session, ai, store, analysis_id)
        await food_photos.process_analysis(session, ai, store, analysis_id)
        await food_photos.process_analysis(session, ai, store, uuid.uuid4())

    assert len(replay.requests) == 1


async def test_an_abandoned_analysis_stops_being_pending(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions
) -> None:
    analysis_id = await start(api_client, auth)
    async with session_factory() as session:
        row = await session.get(PhotoAnalysis, analysis_id)
        assert row is not None
        user = await session.get(User, row.user_id)
        assert user is not None
        late = datetime.now(UTC) + timedelta(minutes=10)
        out = await food_photos.get_analysis(session, user, analysis_id, late)

    assert (out.status, out.error) == (AnalysisStatus.FAILED, "timed_out")


async def test_a_task_for_a_deleted_user_does_nothing(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    store: MemoryStore,
    replay: Replay,
    ai: AiClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analysis_id = await start(api_client, auth)
    async with session_factory() as session:

        async def nobody(model: Any, row_id: Any) -> Any:
            row = PhotoAnalysis(
                id=analysis_id,
                user_id=uuid.uuid4(),
                object_key="k.jpg",
                status=AnalysisStatus.PENDING,
            )
            return row if model is PhotoAnalysis else None

        monkeypatch.setattr(session, "get", nobody)
        await food_photos.process_analysis(session, ai, store, analysis_id)

    assert replay.requests == []


async def test_only_the_owner_sees_an_analysis(api_client: AsyncClient, auth: Headers) -> None:
    analysis_id = await start(api_client, auth)
    other = bearer(await register_user(api_client, "other@example.com"))

    response = await api_client.get(f"/v1/nutrition/photo/{analysis_id}", headers=other)

    assert response.status_code == 404
    assert (
        await api_client.get(f"/v1/nutrition/photo/{uuid.uuid4()}", headers=auth)
    ).status_code == 404


async def test_photos_are_stored_under_the_user(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions, store: MemoryStore
) -> None:
    await start(api_client, auth)

    async with session_factory() as session:
        row = await session.scalar(select(PhotoAnalysis))
    assert row is not None
    assert row.object_key.startswith(f"{row.user_id}/")
    assert row.object_key.endswith(".jpg")
    assert store.objects[row.object_key] == JPEG


async def test_only_real_images_of_a_sensible_size_are_accepted(
    api_client: AsyncClient, auth: Headers, test_settings: Settings
) -> None:
    fake = await api_client.post("/v1/nutrition/photo", headers=auth, **upload(b"<html>"))
    huge = await api_client.post(
        "/v1/nutrition/photo",
        headers=auth,
        **upload(JPEG + b"0" * test_settings.ai_photo_max_bytes),
    )

    assert fake.status_code == 422
    assert huge.status_code == 422


async def test_a_free_user_gets_five_photos_a_day(api_client: AsyncClient, auth: Headers) -> None:
    for _ in range(5):
        await start(api_client, auth)

    response = await api_client.post("/v1/nutrition/photo", headers=auth, **upload())

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"


async def test_without_a_key_the_app_is_told_to_offer_manual_entry(
    api_client: AsyncClient, auth: Headers, app: FastAPI, test_settings: Settings
) -> None:
    unconfigured = test_settings.model_copy(update={"anthropic_api_key": ""})
    app.dependency_overrides[get_ai_client] = lambda: AiClient(unconfigured)

    response = await api_client.post("/v1/nutrition/photo", headers=auth, **upload())

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_unavailable"


async def test_storage_trouble_is_a_503(
    api_client: AsyncClient, auth: Headers, store: MemoryStore
) -> None:
    store.fail = True

    response = await api_client.post("/v1/nutrition/photo", headers=auth, **upload())

    assert response.status_code == 503


async def test_a_dead_queue_fails_the_row_instead_of_leaving_it_pending(
    api_client: AsyncClient, auth: Headers, app: FastAPI, session_factory: Sessions
) -> None:
    def broken(_: uuid.UUID) -> None:
        raise ConnectionError("broker down")

    app.dependency_overrides[get_photo_queue] = lambda: broken

    response = await api_client.post("/v1/nutrition/photo", headers=auth, **upload())

    assert response.status_code == 503
    async with session_factory() as session:
        row = await session.scalar(select(PhotoAnalysis))
    assert row is not None
    assert (row.status, row.error) == (AnalysisStatus.FAILED, "not_queued")


async def test_the_s3_store_signs_for_the_internal_address(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith("missing.jpg"):
            return httpx.Response(404)
        return httpx.Response(200, content=b"bytes")

    real = httpx.AsyncClient
    monkeypatch.setattr(
        "app.services.storage.httpx.AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )
    settings = test_settings.model_copy(
        update={"s3_endpoint_url": "http://s3:8333", "s3_public_url": "http://192.168.1.2:9010"}
    )
    s3 = S3PhotoStore(settings)

    await s3.put("u/a.jpg", b"x", "image/jpeg")
    assert await s3.get("u/a.jpg") == b"bytes"
    with pytest.raises(StorageError):
        await s3.get("u/missing.jpg")

    assert calls[0].method == "PUT"
    assert calls[0].url.host == "s3"
    assert calls[0].url.path == "/food-photos/u/a.jpg"
    assert calls[0].headers["Content-Type"] == "image/jpeg"
