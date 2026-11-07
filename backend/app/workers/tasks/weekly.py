import asyncio
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.ai.client import AiClient
from app.config import get_settings
from app.services.coach import generate_due_reports
from app.workers.celery_app import celery_app
from app.workers.tasks.push import enqueue_push


async def _generate() -> int:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    ai = AiClient(settings)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            return await generate_due_reports(session, ai, datetime.now(UTC), enqueue_push)
    finally:
        await ai.aclose()
        await engine.dispose()


# Several users' reports in one run, so well past the default limits.
@celery_app.task(name="coach.generate_weekly_reports", soft_time_limit=3000, time_limit=3300)
def generate_weekly_reports() -> int:
    """Monday 06:00 local reports, run hourly for every timezone (`services/coach.py`)."""
    return asyncio.run(_generate())
