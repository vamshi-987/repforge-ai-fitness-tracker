from collections.abc import AsyncIterator

import pytest
from fakeredis import FakeAsyncRedis
from redis.exceptions import ConnectionError as RedisConnectionError

from app.services.rate_limit import hit

KEY = "rl:login:1.2.3.4"


@pytest.fixture
async def redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis(decode_responses=True)
    yield client
    await client.aclose()


async def test_allows_up_to_the_limit(redis: FakeAsyncRedis) -> None:
    results = [await hit(redis, KEY, limit=3, window_s=60, now_ms=1_000 + i) for i in range(3)]

    assert [r.allowed for r in results] == [True, True, True]
    assert [r.remaining for r in results] == [2, 1, 0]


async def test_rejects_over_the_limit_with_retry_after(redis: FakeAsyncRedis) -> None:
    for i in range(3):
        await hit(redis, KEY, limit=3, window_s=60, now_ms=10_000 + i * 1_000)

    result = await hit(redis, KEY, limit=3, window_s=60, now_ms=25_000)

    assert not result.allowed
    # Oldest attempt (t=10 s) leaves the 60 s window at t=70 s, 45 s from now.
    assert result.retry_after_s == 45


async def test_rejected_attempts_do_not_extend_the_block(redis: FakeAsyncRedis) -> None:
    for i in range(3):
        await hit(redis, KEY, limit=3, window_s=60, now_ms=i)
    for i in range(10):
        assert not (await hit(redis, KEY, limit=3, window_s=60, now_ms=1_000 + i)).allowed

    # Exactly when Retry-After said, the next attempt is allowed again.
    assert (await hit(redis, KEY, limit=3, window_s=60, now_ms=60_001)).allowed


async def test_window_slides(redis: FakeAsyncRedis) -> None:
    for i in range(3):
        await hit(redis, KEY, limit=3, window_s=60, now_ms=i * 20_000)  # t = 0, 20, 40 s

    assert not (await hit(redis, KEY, limit=3, window_s=60, now_ms=59_000)).allowed
    assert (await hit(redis, KEY, limit=3, window_s=60, now_ms=60_500)).allowed


async def test_keys_are_independent(redis: FakeAsyncRedis) -> None:
    await hit(redis, KEY, limit=1, window_s=60, now_ms=0)

    assert (await hit(redis, "rl:login:5.6.7.8", limit=1, window_s=60, now_ms=1)).allowed


async def test_key_expires_with_the_window(redis: FakeAsyncRedis) -> None:
    await hit(redis, KEY, limit=3, window_s=60, now_ms=0)

    ttl_ms = await redis.pttl(KEY)

    assert 0 < ttl_ms <= 60_000


class BrokenRedis(FakeAsyncRedis):
    def pipeline(self, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        raise RedisConnectionError("redis down")


async def test_fails_open_when_redis_is_down() -> None:
    result = await hit(BrokenRedis(), KEY, limit=3, window_s=60, now_ms=0)

    assert result.allowed
