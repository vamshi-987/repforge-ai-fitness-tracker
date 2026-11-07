import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.ai.client import AiClient
from app.config import get_settings
from app.services.food_photos import process_analysis
from app.services.storage import S3PhotoStore
from app.workers.celery_app import celery_app


async def _analyze(analysis_id: uuid.UUID) -> None:
    # Each task runs in its own event loop, so nothing here may outlive it.
    settings = get_settings()
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    ai = AiClient(settings)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            await process_analysis(session, ai, S3PhotoStore(settings), analysis_id)
    finally:
        await ai.aclose()
        await engine.dispose()


# Longer than the default limits: 4 tries of 30 s, twice if the first reply is invalid.
@celery_app.task(name="nutrition.analyze_photo", soft_time_limit=270, time_limit=300)
def analyze_photo(analysis_id: str) -> None:
    """Read a food photo into a draft (`services/food_photos.py`)."""
    asyncio.run(_analyze(uuid.UUID(analysis_id)))
