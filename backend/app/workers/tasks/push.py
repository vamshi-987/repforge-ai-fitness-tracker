import asyncio
import logging
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.services.push import Notification, deliver
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _send(notification: Notification) -> int:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with (
            AsyncSession(engine, expire_on_commit=False) as session,
            httpx.AsyncClient(timeout=settings.push_http_timeout_s) as http,
        ):
            return await deliver(session, http, settings, notification)
    finally:
        await engine.dispose()


@celery_app.task(name="push.send")
def send_push(user_id: str, title: str, body: str, path: str) -> int:
    return asyncio.run(_send(Notification(uuid.UUID(user_id), title, body, path)))


def enqueue_push(notification: Notification) -> None:
    """Never raises and never waits on a broker that's down: a like still counts without its
    push."""
    try:
        send_push.apply_async(
            args=[
                str(notification.user_id),
                notification.title,
                notification.body,
                notification.path,
            ],
            retry=False,
        )
    except Exception as exc:
        logger.warning("push_not_queued", extra={"error": repr(exc)})
