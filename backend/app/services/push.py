"""Push notifications through Expo. Best effort by design: a lost push costs nothing, so nothing
here ever fails the request that caused it."""

import logging
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from itertools import batched
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import PushToken, User
from app.schemas.push import PushTokenIn

logger = logging.getLogger(__name__)

# Expo's limit per request.
BATCH_SIZE = 100


@dataclass(frozen=True)
class Notification:
    user_id: uuid.UUID
    title: str
    body: str
    # Where the app opens when it's tapped.
    path: str


Notify = Callable[[Notification], None]


async def register_token(
    session: AsyncSession, user: User, body: PushTokenIn, now: datetime
) -> None:
    """Save this device for this user. A token seen before moves to whoever just signed in."""
    fields = {"user_id": user.id, "platform": body.platform, "last_seen_at": now}
    await session.execute(
        insert(PushToken)
        .values(id=uuid.uuid4(), expo_token=body.expo_token, **fields)
        .on_conflict_do_update(index_elements=[PushToken.expo_token], set_=fields)
    )
    await session.commit()


async def remove_token(session: AsyncSession, user: User, token: str) -> None:
    await session.execute(
        delete(PushToken).where(PushToken.user_id == user.id, PushToken.expo_token == token)
    )
    await session.commit()


def expo_messages(tokens: Sequence[str], notification: Notification) -> list[dict[str, Any]]:
    return [
        {
            "to": token,
            "title": notification.title,
            "body": notification.body,
            "data": {"path": notification.path},
            "sound": "default",
        }
        for token in tokens
    ]


def dead_tokens(messages: Sequence[dict[str, Any]], tickets: Sequence[dict[str, Any]]) -> set[str]:
    """Devices Expo says are gone. Tickets come back in the order of the messages."""
    return {
        message["to"]
        for message, ticket in zip(messages, tickets, strict=False)
        if ticket.get("status") == "error"
        and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"
    }


async def _post(
    http: httpx.AsyncClient, settings: Settings, messages: Sequence[dict[str, Any]]
) -> list[dict[str, Any]]:
    headers = {"Accept": "application/json"}
    if settings.expo_access_token:
        headers["Authorization"] = f"Bearer {settings.expo_access_token}"
    response = await http.post(settings.expo_push_url, json=list(messages), headers=headers)
    response.raise_for_status()
    tickets: list[dict[str, Any]] = response.json()["data"]
    return tickets


async def deliver(
    session: AsyncSession,
    http: httpx.AsyncClient,
    settings: Settings,
    notification: Notification,
) -> int:
    """Send to every device of the user; returns how many messages went out."""
    tokens = list(
        await session.scalars(
            select(PushToken.expo_token).where(PushToken.user_id == notification.user_id)
        )
    )
    sent = 0
    gone: set[str] = set()
    for chunk in batched(tokens, BATCH_SIZE):
        messages = expo_messages(chunk, notification)
        try:
            tickets = await _post(http, settings, messages)
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            logger.warning("push_failed", extra={"error": repr(exc)})
            continue
        gone |= dead_tokens(messages, tickets)
        sent += len(messages)
    if gone:
        await session.execute(delete(PushToken).where(PushToken.expo_token.in_(gone)))
        await session.commit()
    return sent
