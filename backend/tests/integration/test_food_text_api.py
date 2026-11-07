"""Free text to a draft. Claude is replayed; Redis is fake, so caching runs for real."""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from httpx import AsyncClient
from redis.exceptions import RedisError

from app.ai.client import AiClient, get_ai_client
from app.config import Settings
from app.services.food_text import CACHE_TTL_S, cache_key
from tests.ai_replay import Replay, canned, fixture, replay_client
from tests.integration.helpers import bearer, register_user

pytestmark = pytest.mark.integration

Headers = dict[str, str]
TEXT = "2 rotis and a bowl of dal"


@pytest.fixture
def replay() -> Replay:
    return Replay()


@pytest.fixture
async def auth(
    api_client: AsyncClient, app: FastAPI, replay: Replay, test_settings: Settings
) -> AsyncIterator[Headers]:
    client = replay_client(replay, test_settings)
    app.dependency_overrides[get_ai_client] = lambda: client
    yield bearer(await register_user(api_client))


async def parse(client: AsyncClient, auth: Headers, text: str = TEXT) -> dict[str, Any]:
    response = await client.post("/v1/nutrition/parse-text", json={"text": text}, headers=auth)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_text_becomes_a_draft(api_client: AsyncClient, auth: Headers, replay: Replay) -> None:
    replay.replies.append(fixture("food_text"))
    created = await api_client.post(
        "/v1/foods",
        headers=auth,
        json={"name": "Dal", "kcal_100g": 100, "protein_100g": 7, "carbs_100g": 15, "fat_100g": 1},
    )

    draft = await parse(api_client, auth)

    roti, dal = draft["items"]
    assert roti["food_id"] is None
    assert (roti["grams"], roti["kcal"]) == (80, 240)
    # The user's own dal, 200 g of it.
    assert dal["food_id"] == created.json()["id"]
    assert (dal["kcal"], dal["protein_g"]) == (200, 14)
    assert draft["notes"] == "Assumed two medium rotis and one 200 g bowl."
    assert replay.requests[0]["messages"][0]["content"] == [{"type": "text", "text": TEXT}]


async def test_the_same_text_costs_one_call_for_a_day(
    api_client: AsyncClient, auth: Headers, replay: Replay, fake_redis: FakeAsyncRedis
) -> None:
    replay.replies.append(fixture("food_text"))

    first = await parse(api_client, auth)
    again = await parse(api_client, auth, "  2 ROTIS   and a bowl of dal ")

    assert first == again
    assert len(replay.requests) == 1
    assert 0 < await fake_redis.ttl(cache_key(TEXT)) <= CACHE_TTL_S


async def test_a_cached_estimate_is_matched_against_each_users_own_foods(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    replay.replies.append(fixture("food_text"))
    await parse(api_client, auth)
    other = bearer(await register_user(api_client, "other@example.com"))
    created = await api_client.post(
        "/v1/foods",
        headers=other,
        json={"name": "Roti", "kcal_100g": 300, "protein_100g": 9, "carbs_100g": 50, "fat_100g": 7},
    )

    draft = await parse(api_client, other)

    assert draft["items"][0]["food_id"] == created.json()["id"]
    assert len(replay.requests) == 1


async def test_unreadable_cache_entries_are_ignored(
    api_client: AsyncClient, auth: Headers, replay: Replay, fake_redis: FakeAsyncRedis
) -> None:
    await fake_redis.set(cache_key(TEXT), "{broken")
    replay.replies.append(fixture("food_text"))

    await parse(api_client, auth)

    assert len(replay.requests) == 1


async def test_a_cache_outage_only_costs_a_call(
    api_client: AsyncClient,
    auth: Headers,
    replay: Replay,
    fake_redis: FakeAsyncRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def down(*args: object, **kwargs: object) -> None:
        raise RedisError("down")

    monkeypatch.setattr(fake_redis, "get", down)
    monkeypatch.setattr(fake_redis, "set", down)
    replay.replies.append(fixture("food_text"))

    assert (await parse(api_client, auth))["items"]


async def test_text_without_food_gives_an_empty_draft(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    replay.replies.append(canned({"items": [], "notes": "no food detected"}))

    assert await parse(api_client, auth, "what a day") == {
        "items": [],
        "notes": "no food detected",
    }


async def test_a_failed_call_tells_the_app_to_offer_manual_entry(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    replay.replies.append(500)

    response = await api_client.post("/v1/nutrition/parse-text", json={"text": TEXT}, headers=auth)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_unavailable"


async def test_without_a_key_too(
    api_client: AsyncClient, auth: Headers, app: FastAPI, test_settings: Settings
) -> None:
    client = AiClient(test_settings.model_copy(update={"anthropic_api_key": ""}))
    app.dependency_overrides[get_ai_client] = lambda: client

    response = await api_client.post("/v1/nutrition/parse-text", json={"text": TEXT}, headers=auth)

    assert response.status_code == 503


async def test_a_free_user_is_limited_but_cached_text_is_free(
    api_client: AsyncClient, auth: Headers, replay: Replay, test_settings: Settings
) -> None:
    empty = canned({"items": [], "notes": ""})
    replay.replies.extend([empty] * test_settings.ai_text_limit_free)
    for number in range(test_settings.ai_text_limit_free):
        await parse(api_client, auth, f"meal {number}")

    over = await api_client.post(
        "/v1/nutrition/parse-text", json={"text": "one more"}, headers=auth
    )

    assert over.status_code == 429
    await parse(api_client, auth, "meal 0")


@pytest.mark.parametrize("text", ["", "   ", "x" * 501])
async def test_text_must_be_sensible(api_client: AsyncClient, auth: Headers, text: str) -> None:
    response = await api_client.post("/v1/nutrition/parse-text", json={"text": text}, headers=auth)

    assert response.status_code == 422
