import asyncio
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.services.account import purge_closed_accounts
from app.services.storage import S3PhotoStore
from app.workers.celery_app import celery_app


async def _purge() -> int:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            return await purge_closed_accounts(
                session, settings, S3PhotoStore(settings), datetime.now(UTC)
            )
    finally:
        await engine.dispose()


@celery_app.task(name="account.purge_deleted", soft_time_limit=3000, time_limit=3300)
def purge_deleted() -> int:
    """Erase accounts closed 28 days ago (`services/account.py`)."""
    return asyncio.run(_purge())
