"""Free text ("2 rotis and a bowl of dal") to a draft, the same draft a photo gives."""

import hashlib
import logging
from datetime import datetime

from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AiClient, AiError
from app.ai.food_vision import estimate_text, to_draft
from app.ai.schemas import FoodEstimate
from app.cache.redis import get_text
from app.config import Settings
from app.core.errors import AppError
from app.db.models import User
from app.schemas.nutrition import FoodDraft
from app.services.ai_limits import enforce_daily_limit

logger = logging.getLogger(__name__)

CACHE_TTL_S = 24 * 3600


def cache_key(text: str) -> str:
    """Identical text, whatever its case or spacing, is one model call. The cached value is the
    model's estimate: matching runs per request, because custom foods differ per user."""
    normal = " ".join(text.lower().split())
    return f"ai:text:{hashlib.sha256(normal.encode()).hexdigest()}"


async def _cached(redis: Redis, key: str) -> FoodEstimate | None:
    try:
        raw = await get_text(redis, key)
        return FoodEstimate.model_validate_json(raw) if raw else None
    except (RedisError, ValidationError) as exc:
        logger.warning("ai_cache_unavailable", extra={"error": repr(exc)})
        return None


async def _remember(redis: Redis, key: str, estimate: FoodEstimate) -> None:
    try:
        await redis.set(key, estimate.model_dump_json(), ex=CACHE_TTL_S)
    except RedisError as exc:
        logger.warning("ai_cache_unavailable", extra={"error": repr(exc)})


async def parse_text(
    session: AsyncSession,
    redis: Redis,
    settings: Settings,
    ai: AiClient,
    user: User,
    text: str,
    now: datetime,
) -> FoodDraft:
    key = cache_key(text)
    estimate = await _cached(redis, key)
    if estimate is None:
        await enforce_daily_limit(redis, settings, user, "text", now)
        try:
            estimate = await estimate_text(ai, text)
        except AiError as exc:
            raise AppError(
                "ai_unavailable", "That couldn't be read right now. Add it by hand.", 503
            ) from exc
        await _remember(redis, key, estimate)
    return await to_draft(session, user, estimate)
