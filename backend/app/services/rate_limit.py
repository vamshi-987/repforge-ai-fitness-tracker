"""Sliding-window rate limiting on a Redis sorted set (one member per attempt, scored by time)."""

import logging
import math
import uuid
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_s: int


async def hit(redis: Redis, key: str, limit: int, window_s: int, now_ms: int) -> RateLimitResult:
    """Record one attempt and report whether it is within `limit` attempts per `window_s`.

    A rejected attempt is removed again, so `retry_after_s` (when the oldest counted attempt
    leaves the window) is exactly when the next attempt will be allowed. If Redis is
    unavailable the attempt is allowed: a cache outage must not lock every user out.
    """
    window_ms = window_s * 1000
    member = f"{now_ms}:{uuid.uuid4().hex}"
    try:
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, now_ms - window_ms)
            pipe.zadd(key, {member: now_ms})
            pipe.zcard(key)
            pipe.zrange(key, 0, 0, withscores=True)
            pipe.pexpire(key, window_ms)
            _, _, count, oldest, _ = await pipe.execute()
        if count <= limit:
            return RateLimitResult(allowed=True, remaining=limit - count, retry_after_s=0)
        await redis.zrem(key, member)
    except RedisError as exc:
        logger.warning("rate_limit_unavailable", extra={"key": key, "error": repr(exc)})
        return RateLimitResult(allowed=True, remaining=limit, retry_after_s=0)

    oldest_ms = int(oldest[0][1])
    retry_after_s = max(1, math.ceil((oldest_ms + window_ms - now_ms) / 1000))
    return RateLimitResult(allowed=False, remaining=0, retry_after_s=retry_after_s)
