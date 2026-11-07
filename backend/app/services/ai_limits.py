"""How many LLM calls a user may start per 24 hours (CLAUDE.md §7)."""

from datetime import datetime
from typing import Literal

from redis.asyncio import Redis

from app.config import Settings
from app.core.errors import RateLimitedError
from app.db.models import User
from app.services import rate_limit

DAY_S = 24 * 3600

Feature = Literal["photo", "text"]


def daily_limit(settings: Settings, feature: Feature, is_pro: bool) -> int:
    if feature == "photo":
        return settings.ai_photo_limit_pro if is_pro else settings.ai_photo_limit_free
    return settings.ai_text_limit_pro if is_pro else settings.ai_text_limit_free


async def enforce_daily_limit(
    redis: Redis, settings: Settings, user: User, feature: Feature, now: datetime
) -> None:
    result = await rate_limit.hit(
        redis,
        f"rl:ai:{feature}:{user.id}",
        daily_limit(settings, feature, user.is_pro),
        DAY_S,
        now_ms=int(now.timestamp() * 1000),
    )
    if not result.allowed:
        raise RateLimitedError(result.retry_after_s)
