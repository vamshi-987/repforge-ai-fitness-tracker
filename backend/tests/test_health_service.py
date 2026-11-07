import asyncio
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.health import ReadinessChecks
from app.services import health
from tests.conftest import FakeRedis, FakeSession


class SlowRedis:
    async def ping(self) -> bool:
        await asyncio.sleep(1)
        return True


class SlowSession:
    async def execute(self, *_: object) -> None:
        await asyncio.sleep(1)


def as_session(fake: object) -> AsyncSession:
    return cast(AsyncSession, fake)


async def test_check_database_ok() -> None:
    assert await health.check_database(as_session(FakeSession()), timeout_s=1) == "ok"


async def test_check_database_down_on_error() -> None:
    assert await health.check_database(as_session(FakeSession(fail=True)), timeout_s=1) == "down"


async def test_check_database_down_on_timeout() -> None:
    assert await health.check_database(as_session(SlowSession()), timeout_s=0.01) == "down"


async def test_check_redis_ok() -> None:
    assert await health.check_redis(FakeRedis(), timeout_s=1) == "ok"


async def test_check_redis_down_on_error() -> None:
    assert await health.check_redis(FakeRedis(fail=True), timeout_s=1) == "down"


async def test_check_redis_down_on_timeout() -> None:
    assert await health.check_redis(SlowRedis(), timeout_s=0.01) == "down"


@pytest.mark.parametrize(
    ("database", "redis", "expected"),
    [("ok", "ok", "ok"), ("down", "ok", "degraded"), ("ok", "down", "degraded")],
)
def test_overall_status(database: str, redis: str, expected: str) -> None:
    checks = ReadinessChecks.model_validate({"database": database, "redis": redis})

    assert health.overall_status(checks) == expected


async def test_readiness_combines_checks() -> None:
    overall, checks = await health.readiness(
        as_session(FakeSession()), FakeRedis(fail=True), timeout_s=1
    )

    assert overall == "degraded"
    assert checks == ReadinessChecks(database="ok", redis="down")
