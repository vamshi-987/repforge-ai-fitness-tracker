"""RevenueCat's webhook: who is Pro, whatever order and however often events arrive."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.db.models import SubscriptionEvent
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Sessions = async_sessionmaker[AsyncSession]
Headers = dict[str, str]

SECRET = "webhook-secret"
HOOK = {"Authorization": SECRET}
T0 = 1_790_000_000_000
DAY_MS = 86_400_000


@pytest.fixture
async def configured(app: FastAPI, api_client: AsyncClient, test_settings: Settings) -> Any:
    settings = test_settings.model_copy(update={"revenuecat_webhook_secret": SECRET})
    app.dependency_overrides[get_settings] = lambda: settings


@pytest.fixture
async def user(api_client: AsyncClient, configured: None) -> AsyncIterator[tuple[Headers, str]]:
    auth = bearer(await register_user(api_client))
    me = await api_client.get("/v1/me", headers=auth)
    yield auth, me.json()["id"]


def event(user_id: str, kind: str, at: int = T0, **extra: Any) -> dict[str, Any]:
    return {
        "api_version": "1.0",
        "event": {
            "id": str(uuid.uuid4()),
            "type": kind,
            "app_user_id": user_id,
            "event_timestamp_ms": at,
            "entitlement_ids": ["pro"],
            "product_id": "repforge_pro_monthly",
            **extra,
        },
    }


async def send(client: AsyncClient, body: dict[str, Any]) -> None:
    response = await client.post("/v1/webhooks/revenuecat", json=body, headers=HOOK)
    assert response.status_code == 204, response.text


async def is_pro(client: AsyncClient, auth: Headers) -> bool:
    pro: bool = (await client.get("/v1/me", headers=auth)).json()["is_pro"]
    return pro


@pytest.mark.parametrize(
    "kind",
    [
        "INITIAL_PURCHASE",
        "RENEWAL",
        "UNCANCELLATION",
        "PRODUCT_CHANGE",
        "NON_RENEWING_PURCHASE",
        "SUBSCRIPTION_EXTENDED",
    ],
)
async def test_buying_grants_pro(
    api_client: AsyncClient, user: tuple[Headers, str], kind: str
) -> None:
    auth, user_id = user

    await send(api_client, event(user_id, kind))

    assert await is_pro(api_client, auth) is True


async def test_expiry_ends_pro(api_client: AsyncClient, user: tuple[Headers, str]) -> None:
    auth, user_id = user
    await send(api_client, event(user_id, "INITIAL_PURCHASE"))

    await send(api_client, event(user_id, "EXPIRATION", T0 + DAY_MS))

    assert await is_pro(api_client, auth) is False


async def test_cancelling_keeps_pro_until_the_period_ends(
    api_client: AsyncClient, user: tuple[Headers, str]
) -> None:
    auth, user_id = user
    await send(api_client, event(user_id, "INITIAL_PURCHASE"))
    future = int((datetime.now(UTC) + timedelta(days=20)).timestamp() * 1000)

    await send(api_client, event(user_id, "CANCELLATION", T0 + 1, expiration_at_ms=future))

    assert await is_pro(api_client, auth) is True


async def test_a_refund_ends_pro_at_once(
    api_client: AsyncClient, user: tuple[Headers, str]
) -> None:
    auth, user_id = user
    await send(api_client, event(user_id, "INITIAL_PURCHASE"))
    past = int((datetime.now(UTC) - timedelta(minutes=1)).timestamp() * 1000)

    await send(api_client, event(user_id, "CANCELLATION", T0 + 1, expiration_at_ms=past))

    assert await is_pro(api_client, auth) is False


@pytest.mark.parametrize("kind", ["BILLING_ISSUE", "TEST", "SUBSCRIPTION_PAUSED", "SOMETHING_NEW"])
async def test_other_events_change_nothing(
    api_client: AsyncClient, user: tuple[Headers, str], kind: str
) -> None:
    auth, user_id = user
    await send(api_client, event(user_id, "INITIAL_PURCHASE"))

    await send(api_client, event(user_id, kind, T0 + 1))

    assert await is_pro(api_client, auth) is True


async def test_a_redelivered_event_counts_once(
    api_client: AsyncClient, user: tuple[Headers, str], session_factory: Sessions
) -> None:
    auth, user_id = user
    purchase = event(user_id, "INITIAL_PURCHASE")
    expiry = event(user_id, "EXPIRATION", T0 + DAY_MS)
    await send(api_client, purchase)
    await send(api_client, expiry)

    # The purchase arrives again after the expiry; it must not bring Pro back.
    await send(api_client, purchase)

    assert await is_pro(api_client, auth) is False
    async with session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(SubscriptionEvent)) == 2


async def test_an_old_event_arriving_late_doesnt_win(
    api_client: AsyncClient, user: tuple[Headers, str]
) -> None:
    auth, user_id = user
    await send(api_client, event(user_id, "RENEWAL", T0 + DAY_MS))

    await send(api_client, event(user_id, "EXPIRATION", T0))

    assert await is_pro(api_client, auth) is True


async def test_another_products_event_is_ignored(
    api_client: AsyncClient, user: tuple[Headers, str]
) -> None:
    auth, user_id = user

    await send(api_client, event(user_id, "INITIAL_PURCHASE", entitlement_ids=["other"]))

    assert await is_pro(api_client, auth) is False


async def test_events_for_unknown_users_are_kept_and_accepted(
    api_client: AsyncClient, configured: None, session_factory: Sessions
) -> None:
    await send(api_client, event("$RCAnonymousID:abc", "INITIAL_PURCHASE"))
    await send(api_client, event(str(uuid.uuid4()), "INITIAL_PURCHASE"))

    async with session_factory() as session:
        rows = list(await session.scalars(select(SubscriptionEvent)))
    assert [r.user_id for r in rows] == [None, None]


async def test_a_transfer_moves_pro_between_accounts(
    api_client: AsyncClient, user: tuple[Headers, str]
) -> None:
    auth, old_id = user
    await send(api_client, event(old_id, "INITIAL_PURCHASE"))
    other = bearer(await register_user(api_client, "other@example.com"))
    new_id = (await api_client.get("/v1/me", headers=other)).json()["id"]

    body = event(
        "",
        "TRANSFER",
        T0 + 1,
        transferred_from=[old_id, "$RCAnonymousID:x"],
        transferred_to=[new_id],
    )
    await send(api_client, body)

    assert await is_pro(api_client, auth) is False
    assert await is_pro(api_client, other) is True


async def test_the_secret_is_required(api_client: AsyncClient, user: tuple[Headers, str]) -> None:
    auth, user_id = user
    body = event(user_id, "INITIAL_PURCHASE")

    missing = await api_client.post("/v1/webhooks/revenuecat", json=body)
    wrong = await api_client.post(
        "/v1/webhooks/revenuecat", json=body, headers={"Authorization": "guess"}
    )

    assert (missing.status_code, wrong.status_code) == (401, 401)
    assert await is_pro(api_client, auth) is False


async def test_without_a_secret_the_webhook_is_off(api_client: AsyncClient) -> None:
    response = await api_client.post(
        "/v1/webhooks/revenuecat", json=event("x", "TEST"), headers=HOOK
    )

    assert response.status_code == 503


async def test_buying_opens_the_pro_gates(
    api_client: AsyncClient, user: tuple[Headers, str]
) -> None:
    auth, user_id = user
    assert (await api_client.get("/v1/coach/weekly-report", headers=auth)).status_code == 403
    assert (await api_client.get("/v1/stats/summary?range=1y", headers=auth)).status_code == 403

    await send(api_client, event(user_id, "INITIAL_PURCHASE"))

    assert (await api_client.get("/v1/coach/weekly-report", headers=auth)).status_code == 200
    assert (await api_client.get("/v1/stats/summary?range=1y", headers=auth)).status_code == 200

    await send(api_client, event(user_id, "EXPIRATION", T0 + DAY_MS))

    assert (await api_client.get("/v1/coach/weekly-report", headers=auth)).status_code == 403
