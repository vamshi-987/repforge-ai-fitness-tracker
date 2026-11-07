import json
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

import httpx
import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from httpx import AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.cache.redis import get_redis
from app.db.models import Food, FoodSource
from app.routers.foods import get_food_http
from app.services.food_library import apply_seed
from tests.integration.helpers import bearer, register_user

pytestmark = pytest.mark.integration

Headers = dict[str, str]
Handler = Callable[[httpx.Request], httpx.Response]


class FakeSources:
    """Answers USDA and Open Food Facts requests from recorded-style bodies."""

    def __init__(self) -> None:
        self.calls: list[httpx.Request] = []
        self.usda: Handler = lambda _: httpx.Response(200, json={"foods": []})
        self.off_search: Handler = lambda _: httpx.Response(200, json={"products": []})
        self.off_product: Handler = lambda _: httpx.Response(200, json={"status": 0})

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if request.url.host == "api.nal.usda.gov":
            return self.usda(request)
        if request.url.path.startswith("/api/v2/product/"):
            return self.off_product(request)
        return self.off_search(request)


@pytest.fixture
def sources(app: FastAPI) -> Iterator[FakeSources]:
    fake = FakeSources()

    async def client() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(fake.handle)) as http:
            yield http

    app.dependency_overrides[get_food_http] = client
    yield fake


@pytest.fixture
async def auth(
    api_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> Headers:
    async with session_factory() as session:
        await apply_seed(session)
    return bearer(await register_user(api_client))


def usda_item(fdc_id: int, name: str, kcal: float = 100) -> dict[str, Any]:
    return {
        "fdcId": fdc_id,
        "description": name,
        "foodNutrients": [
            {"nutrientNumber": "208", "value": kcal},
            {"nutrientNumber": "203", "value": 10},
            {"nutrientNumber": "205", "value": 10},
            {"nutrientNumber": "204", "value": 2},
        ],
    }


def product(code: str, name: str) -> dict[str, Any]:
    return {
        "code": code,
        "product_name": name,
        "brands": "Brand",
        "nutriments": {
            "energy-kcal_100g": 250,
            "proteins_100g": 20,
            "carbohydrates_100g": 30,
            "fat_100g": 5,
        },
    }


async def search(client: AsyncClient, auth: Headers, q: str) -> dict[str, Any]:
    response = await client.get("/v1/foods/search", headers=auth, params={"q": q})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_search_requires_auth(api_client: AsyncClient) -> None:
    assert (await api_client.get("/v1/foods/search?q=dal")).status_code == 401


async def test_the_library_answers_first(
    api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    body = await search(api_client, auth, "roti")

    assert body["items"][0]["name"] == "Roti / chapati"
    assert body["items"][0]["servings"] == [{"label": "1 piece", "grams": 68.0}]
    assert body["items"][0]["is_custom"] is False


async def test_a_typo_still_finds_the_food(
    api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    body = await search(api_client, auth, "biryanii")

    assert "Chicken biryani" in [i["name"] for i in body["items"]]


async def test_too_few_local_matches_ask_usda_and_cache(
    api_client: AsyncClient, auth: Headers, sources: FakeSources, fake_redis: FakeAsyncRedis
) -> None:
    sources.usda = lambda _: httpx.Response(
        200, json={"foods": [usda_item(111, "Quinoa, cooked", 120), usda_item(112, "No energy", 0)]}
    )

    first = await search(api_client, auth, "quinoa")
    calls = len(sources.calls)
    second = await search(api_client, auth, "Quinoa ")

    names = [i["name"] for i in first["items"]]
    assert "Quinoa, cooked" in names and first["partial"] is False
    assert first["items"][names.index("Quinoa, cooked")]["source"] == "usda"
    # Cached: the second search is answered without asking anyone.
    assert len(sources.calls) == calls
    assert [i["id"] for i in second["items"]] == [i["id"] for i in first["items"]]
    usda_request = next(r for r in sources.calls if r.url.host == "api.nal.usda.gov")
    assert usda_request.method == "POST"
    assert usda_request.url.params["api_key"] == "DEMO_KEY"
    assert json.loads(usda_request.content)["dataType"][2] == "Survey (FNDDS)"


async def test_open_food_facts_fills_in_and_outages_are_partial(
    api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    sources.usda = lambda _: httpx.Response(429, json={"error": "rate limited"})
    sources.off_search = lambda _: httpx.Response(
        200, json={"products": [product("5000000000001", "Masala Oats")]}
    )

    body = await search(api_client, auth, "masala oats")

    assert "Masala Oats" in [i["name"] for i in body["items"]]
    assert body["partial"] is True


async def test_everything_offline_still_returns_local(
    api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    sources.usda = sources.off_search = down

    body = await search(api_client, auth, "paneer")

    assert body["partial"] is True
    assert "Paneer" in [i["name"] for i in body["items"]]


async def test_short_queries_return_nothing(
    api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    assert await search(api_client, auth, " a ") == {"items": [], "partial": False}
    assert sources.calls == []


async def test_custom_foods_come_first_and_stay_private(
    api_client: AsyncClient,
    auth: Headers,
    sources: FakeSources,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    me = (await api_client.get("/v1/me", headers=auth)).json()
    async with session_factory() as session:
        session.add(
            Food(
                owner_user_id=me["id"],
                source=FoodSource.CUSTOM,
                name="Mom's dal",
                kcal_100g=120,
                protein_100g=7,
                carbs_100g=15,
                fat_100g=3,
            )
        )
        await session.commit()
    other = bearer(await register_user(api_client, email="other@example.com"))

    mine = await search(api_client, auth, "dal")
    theirs = await search(api_client, other, "dal")

    assert mine["items"][0]["name"] == "Mom's dal" and mine["items"][0]["is_custom"]
    assert "Mom's dal" not in [i["name"] for i in theirs["items"]]
    hidden = await api_client.get(f"/v1/foods/{mine['items'][0]['id']}", headers=other)
    shown = await api_client.get(f"/v1/foods/{mine['items'][0]['id']}", headers=auth)
    assert (hidden.status_code, shown.status_code) == (404, 200)


async def test_a_barcode_is_fetched_once_then_found_locally(
    api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    sources.off_product = lambda _: httpx.Response(
        200, json={"status": 1, "product": product("8901058000290", "Glucose Biscuits")}
    )

    first = await api_client.get("/v1/foods/barcode/8901058000290", headers=auth)
    calls = len(sources.calls)
    again = await api_client.get("/v1/foods/barcode/8901058000290", headers=auth)

    assert first.status_code == 200, first.text
    assert (first.json()["name"], first.json()["source"]) == ("Glucose Biscuits", "off")
    assert first.json()["barcode"] == "8901058000290"
    assert again.json()["id"] == first.json()["id"]
    assert len(sources.calls) == calls


async def test_an_unknown_barcode_is_remembered(
    api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    first = await api_client.get("/v1/foods/barcode/00000000", headers=auth)
    again = await api_client.get("/v1/foods/barcode/00000000", headers=auth)

    assert (first.status_code, again.status_code) == (404, 404)
    assert len([r for r in sources.calls if "/api/v2/product/" in r.url.path]) == 1


async def test_barcode_errors(api_client: AsyncClient, auth: Headers, sources: FakeSources) -> None:
    bad = await api_client.get("/v1/foods/barcode/12ab", headers=auth)
    sources.off_product = lambda _: httpx.Response(502)
    down = await api_client.get("/v1/foods/barcode/12345678", headers=auth)
    sources.off_product = lambda _: httpx.Response(200, content=b"<html>")
    garbled = await api_client.get("/v1/foods/barcode/12345679", headers=auth)

    assert bad.status_code == 422
    assert (down.status_code, down.json()["error"]["code"]) == (503, "food_source_unavailable")
    assert garbled.status_code == 503


async def test_enough_local_matches_skip_the_online_sources(
    api_client: AsyncClient,
    auth: Headers,
    sources: FakeSources,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    me = (await api_client.get("/v1/me", headers=auth)).json()
    async with session_factory() as session:
        session.add_all(
            Food(
                owner_user_id=me["id"],
                source=FoodSource.CUSTOM,
                name=f"Protein bar {n}",
                kcal_100g=380,
                protein_100g=30,
                carbs_100g=40,
                fat_100g=10,
            )
            for n in range(9)
        )
        await session.commit()

    body = await search(api_client, auth, "protein bar")

    assert all(i["is_custom"] for i in body["items"][:9])
    assert sources.calls == []


class BrokenRedis:
    async def get(self, _: str) -> None:
        raise RedisConnectionError("down")

    async def set(self, *_: object, **__: object) -> None:
        raise RedisConnectionError("down")


async def test_a_redis_outage_never_fails_a_search(
    app: FastAPI, api_client: AsyncClient, auth: Headers, sources: FakeSources
) -> None:
    app.dependency_overrides[get_redis] = lambda: BrokenRedis()
    sources.usda = lambda _: httpx.Response(200, json={"foods": [usda_item(7, "Ragi flour", 328)]})

    body = await search(api_client, auth, "ragi")

    assert "Ragi flour" in [i["name"] for i in body["items"]]
