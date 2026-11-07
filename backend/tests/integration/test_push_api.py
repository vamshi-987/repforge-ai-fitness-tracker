"""Push tokens, the events that send a push, and delivery to Expo (replayed)."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.db.models import PushToken
from app.routers.social import get_notify
from app.services.library_seed import library_id
from app.services.push import BATCH_SIZE, Notification, deliver
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Sessions = async_sessionmaker[AsyncSession]
Headers = dict[str, str]

BENCH = str(library_id("exercise", "bench-press-barbell"))
TOKEN = "ExponentPushToken[abc123]"


@pytest.fixture
def sent(app: FastAPI, api_client: AsyncClient) -> list[Notification]:
    pushes: list[Notification] = []
    app.dependency_overrides[get_notify] = lambda: pushes.append
    return pushes


async def signed_up(client: AsyncClient, name: str) -> tuple[Headers, str]:
    headers = bearer(await register_user(client, f"{name}@example.com"))
    me = await client.patch(
        "/v1/me", headers=headers, json={"username": name, "display_name": name.title()}
    )
    user_id: str = me.json()["id"]
    return headers, user_id


async def workout(client: AsyncClient, auth: Headers) -> str:
    workout_id = str(uuid.uuid4())
    ended = datetime.now(UTC) - timedelta(hours=1)
    response = await client.put(
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
    assert response.status_code in (200, 201), response.text
    return workout_id


async def add_token(client: AsyncClient, auth: Headers, token: str = TOKEN) -> None:
    response = await client.post(
        "/v1/push/tokens", headers=auth, json={"expo_token": token, "platform": "ios"}
    )
    assert response.status_code == 204, response.text


async def tokens(session_factory: Sessions) -> list[PushToken]:
    async with session_factory() as session:
        return list(await session.scalars(select(PushToken)))


# --- tokens -----------------------------------------------------------------------------


async def test_a_token_is_saved_once(api_client: AsyncClient, session_factory: Sessions) -> None:
    auth, user_id = await signed_up(api_client, "ana")

    await add_token(api_client, auth)
    await add_token(api_client, auth)

    (row,) = await tokens(session_factory)
    assert (str(row.user_id), row.expo_token, row.platform) == (user_id, TOKEN, "ios")


async def test_a_token_follows_whoever_signed_in_last(
    api_client: AsyncClient, session_factory: Sessions
) -> None:
    first, _ = await signed_up(api_client, "ana")
    second, second_id = await signed_up(api_client, "ben")

    await add_token(api_client, first)
    await add_token(api_client, second)

    (row,) = await tokens(session_factory)
    assert str(row.user_id) == second_id


async def test_signing_out_removes_only_your_own_token(
    api_client: AsyncClient, session_factory: Sessions
) -> None:
    owner, _ = await signed_up(api_client, "ana")
    other, _ = await signed_up(api_client, "ben")
    await add_token(api_client, owner)

    params = {"token": TOKEN}
    assert (
        await api_client.delete("/v1/push/tokens", headers=other, params=params)
    ).status_code == 204
    assert len(await tokens(session_factory)) == 1

    await api_client.delete("/v1/push/tokens", headers=owner, params=params)
    assert await tokens(session_factory) == []


@pytest.mark.parametrize(
    "body",
    [
        {"expo_token": "nonsense", "platform": "ios"},
        {"expo_token": TOKEN, "platform": "web"},
    ],
)
async def test_bad_tokens_are_refused(api_client: AsyncClient, body: dict[str, str]) -> None:
    auth, _ = await signed_up(api_client, "ana")

    response = await api_client.post("/v1/push/tokens", headers=auth, json=body)

    assert response.status_code == 422


# --- events -----------------------------------------------------------------------------


async def test_a_like_tells_the_owner_once(
    api_client: AsyncClient, sent: list[Notification]
) -> None:
    owner, owner_id = await signed_up(api_client, "ana")
    fan, _ = await signed_up(api_client, "ben")
    workout_id = await workout(api_client, owner)

    await api_client.post(f"/v1/workouts/{workout_id}/like", headers=fan)
    await api_client.post(f"/v1/workouts/{workout_id}/like", headers=fan)

    (push,) = sent
    assert str(push.user_id) == owner_id
    assert (push.title, push.body) == ("Ben", "liked your workout: Push")
    assert push.path == f"/social/workout/{workout_id}"


async def test_your_own_like_and_comment_send_nothing(
    api_client: AsyncClient, sent: list[Notification]
) -> None:
    owner, _ = await signed_up(api_client, "ana")
    workout_id = await workout(api_client, owner)

    await api_client.post(f"/v1/workouts/{workout_id}/like", headers=owner)
    await api_client.post(
        f"/v1/workouts/{workout_id}/comments", headers=owner, json={"body": "Mine"}
    )

    assert sent == []


async def test_a_comment_tells_the_owner_with_a_preview(
    api_client: AsyncClient, sent: list[Notification]
) -> None:
    owner, _ = await signed_up(api_client, "ana")
    fan, _ = await signed_up(api_client, "ben")
    workout_id = await workout(api_client, owner)

    await api_client.post(
        f"/v1/workouts/{workout_id}/comments", headers=fan, json={"body": "x" * 300}
    )

    (push,) = sent
    assert push.title == "Ben commented"
    assert push.body == "x" * 100


async def test_a_follow_tells_the_person_once(
    api_client: AsyncClient, sent: list[Notification]
) -> None:
    _, target = await signed_up(api_client, "ana")
    fan, _ = await signed_up(api_client, "ben")

    await api_client.post(f"/v1/users/{target}/follow", headers=fan)
    await api_client.post(f"/v1/users/{target}/follow", headers=fan)

    (push,) = sent
    assert push.body == "started following you"
    assert push.path == "/social/user/ben"


async def test_a_request_and_its_acceptance_tell_each_side(
    api_client: AsyncClient, sent: list[Notification]
) -> None:
    target, target_id = await signed_up(api_client, "ana")
    fan, fan_id = await signed_up(api_client, "ben")
    await api_client.patch("/v1/me", headers=target, json={"is_private": True})

    await api_client.post(f"/v1/users/{target_id}/follow", headers=fan)
    await api_client.post(f"/v1/follow-requests/{fan_id}/accept", headers=target)

    asked, accepted = sent
    assert (asked.body, asked.path) == ("wants to follow you", "/social/requests")
    assert str(accepted.user_id) == fan_id
    assert accepted.body == "accepted your follow request"


# --- delivery ---------------------------------------------------------------------------


def expo(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def stored_tokens(api_client: AsyncClient, count: int = 1) -> tuple[Notification, list[str]]:
    auth, user_id = await signed_up(api_client, "ana")
    names = [f"ExponentPushToken[t{i}]" for i in range(count)]
    for name in names:
        await add_token(api_client, auth, name)
    return Notification(uuid.UUID(user_id), "Ben", "liked your workout", "/social/x"), names


async def test_delivery_sends_every_device_the_message(
    api_client: AsyncClient, session_factory: Sessions, test_settings: Settings
) -> None:
    push, names = await stored_tokens(api_client, 2)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "x"}] * 2})

    async with session_factory() as session:
        sent = await deliver(session, expo(handler), test_settings, push)

    assert sent == 2
    (request,) = requests
    assert str(request.url) == test_settings.expo_push_url
    assert "authorization" not in request.headers
    messages = json.loads(request.content)
    assert {m["to"] for m in messages} == set(names)
    assert messages[0]["title"] == "Ben"
    assert messages[0]["body"] == "liked your workout"
    assert messages[0]["data"] == {"path": "/social/x"}


async def test_an_access_token_is_sent_when_configured(
    api_client: AsyncClient, session_factory: Sessions, test_settings: Settings
) -> None:
    push, _ = await stored_tokens(api_client)
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("authorization"))
        return httpx.Response(200, json={"data": [{"status": "ok"}]})

    settings = test_settings.model_copy(update={"expo_access_token": "secret"})
    async with session_factory() as session:
        await deliver(session, expo(handler), settings, push)

    assert seen == ["Bearer secret"]


async def test_a_large_list_goes_out_in_batches(
    api_client: AsyncClient,
    session_factory: Sessions,
    test_settings: Settings,
) -> None:
    push, _ = await stored_tokens(api_client, BATCH_SIZE + 1)
    sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        messages = json.loads(request.content)
        sizes.append(len(messages))
        return httpx.Response(200, json={"data": [{"status": "ok"}] * len(messages)})

    async with session_factory() as session:
        await deliver(session, expo(handler), test_settings, push)

    assert sizes == [BATCH_SIZE, 1]


async def test_uninstalled_devices_are_forgotten(
    api_client: AsyncClient, session_factory: Sessions, test_settings: Settings
) -> None:
    push, names = await stored_tokens(api_client, 3)

    def handler(request: httpx.Request) -> httpx.Response:
        order = [m["to"] for m in json.loads(request.content)]
        return httpx.Response(
            200,
            json={
                "data": [
                    {"status": "error", "details": {"error": "DeviceNotRegistered"}}
                    if token == names[0]
                    else {"status": "error", "details": {"error": "MessageRateExceeded"}}
                    if token == names[1]
                    else {"status": "ok"}
                    for token in order
                ]
            },
        )

    async with session_factory() as session:
        await deliver(session, expo(handler), test_settings, push)

    assert {t.expo_token for t in await tokens(session_factory)} == {names[1], names[2]}


async def test_trouble_at_expo_is_only_logged(
    api_client: AsyncClient, session_factory: Sessions, test_settings: Settings
) -> None:
    push, names = await stored_tokens(api_client)

    def down(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    def unreadable(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"errors": []})

    async with session_factory() as session:
        assert await deliver(session, expo(down), test_settings, push) == 0
        assert await deliver(session, expo(unreadable), test_settings, push) == 0

    assert [t.expo_token for t in await tokens(session_factory)] == names


async def test_someone_without_devices_gets_nothing(
    api_client: AsyncClient, session_factory: Sessions, test_settings: Settings
) -> None:
    _, user_id = await signed_up(api_client, "ana")

    def never(_: httpx.Request) -> httpx.Response:
        raise AssertionError("nothing to send")

    push = Notification(uuid.UUID(user_id), "t", "b", "/p")
    async with session_factory() as session:
        assert await deliver(session, expo(never), test_settings, push) == 0
