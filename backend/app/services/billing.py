"""Pro status from RevenueCat's webhook. `users.is_pro` is the single answer every gate reads.

RevenueCat can redeliver events and deliver them out of order, so an event's id is stored once,
and an older event never overrides a newer one.
"""

import hmac
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.errors import AppError, AuthError
from app.db.models import SubscriptionEvent, User
from app.schemas.billing import RevenueCatEvent

logger = logging.getLogger(__name__)

GRANTS_PRO = frozenset(
    {
        "INITIAL_PURCHASE",
        "RENEWAL",
        "UNCANCELLATION",
        "PRODUCT_CHANGE",
        "NON_RENEWING_PURCHASE",
        "SUBSCRIPTION_EXTENDED",
    }
)
TRANSFER = "TRANSFER"
EXPIRATION = "EXPIRATION"
# Cancelling only stops the renewal; access ends at EXPIRATION, unless it was refunded.
CANCELLATION = "CANCELLATION"


def check_secret(settings: Settings, header: str | None) -> None:
    secret = settings.revenuecat_webhook_secret
    if not secret:
        raise AppError("webhook_not_configured", "This webhook isn't set up", 503)
    if not header or not hmac.compare_digest(header, secret):
        raise AuthError("invalid_webhook_secret", "Wrong webhook secret")


def _as_user_id(value: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(value) if value else None
    except ValueError:
        # An anonymous RevenueCat id, from before the app logged the user in.
        return None


def desired_pro(event: RevenueCatEvent, entitlement: str, now: datetime) -> bool | None:
    """What this event means for Pro: yes, no, or nothing."""
    if event.entitlement_ids is not None and entitlement not in event.entitlement_ids:
        return None
    if event.type in GRANTS_PRO:
        return True
    if event.type == EXPIRATION:
        return False
    if event.type == CANCELLATION and event.expiration_at_ms is not None:
        ended = event.expiration_at_ms <= now.timestamp() * 1000
        return False if ended else None
    return None


async def _set_pro(session: AsyncSession, user_id: uuid.UUID, value: bool) -> None:
    await session.execute(update(User).where(User.id == user_id).values(is_pro=value))


async def _transfer(session: AsyncSession, event: RevenueCatEvent) -> None:
    for user_id in map(_as_user_id, event.transferred_from or []):
        if user_id:
            await _set_pro(session, user_id, False)
    for user_id in map(_as_user_id, event.transferred_to or []):
        if user_id:
            await _set_pro(session, user_id, True)


async def _known_user(session: AsyncSession, event: RevenueCatEvent) -> uuid.UUID | None:
    user_id = _as_user_id(event.app_user_id)
    if user_id is None or await session.get(User, user_id) is None:
        return None
    return user_id


async def _newer_event_exists(
    session: AsyncSession, user_id: uuid.UUID, event_at: datetime, rc_event_id: str
) -> bool:
    latest = await session.scalar(
        select(func.max(SubscriptionEvent.event_at)).where(
            SubscriptionEvent.user_id == user_id, SubscriptionEvent.rc_event_id != rc_event_id
        )
    )
    return latest is not None and latest > event_at


async def handle_event(
    session: AsyncSession, settings: Settings, event: RevenueCatEvent, now: datetime
) -> None:
    """Always ends in a 200 for an event it can read: RevenueCat retries anything else."""
    user_id = await _known_user(session, event)
    event_at = datetime.fromtimestamp(event.event_timestamp_ms / 1000, UTC)
    result = await session.execute(
        insert(SubscriptionEvent)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            rc_event_id=event.id,
            type=event.type,
            event_at=event_at,
            payload=event.model_dump(mode="json"),
        )
        .on_conflict_do_nothing(index_elements=[SubscriptionEvent.rc_event_id])
    )
    if not getattr(result, "rowcount", 0):
        await session.commit()
        return
    if event.type == TRANSFER:
        await _transfer(session, event)
    elif user_id is None:
        logger.warning("subscription_unknown_user", extra={"event_id": event.id})
    elif not await _newer_event_exists(session, user_id, event_at, event.id):
        wanted = desired_pro(event, settings.revenuecat_entitlement, now)
        if wanted is not None:
            await _set_pro(session, user_id, wanted)
    await session.commit()
