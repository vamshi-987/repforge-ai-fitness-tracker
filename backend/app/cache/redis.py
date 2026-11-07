from functools import lru_cache
from typing import cast

from redis.asyncio import Redis

from app.config import get_settings


@lru_cache
def get_redis_client() -> Redis:
    settings = get_settings()
    client: Redis = Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=2,
        socket_timeout=2,
        health_check_interval=30,
    )
    return client


async def get_redis() -> Redis:
    return get_redis_client()


async def get_text(redis: Redis, key: str) -> str | None:
    """GET a key. Clients here decode responses, which redis-py's types can't know."""
    return cast("str | None", await redis.get(key))


async def close_redis() -> None:
    if get_redis_client.cache_info().currsize:
        await get_redis_client().aclose()
        get_redis_client.cache_clear()
