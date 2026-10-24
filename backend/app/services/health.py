import asyncio
import logging
from collections.abc import Awaitable
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.health import CheckStatus, OverallStatus, ReadinessChecks

logger = logging.getLogger(__name__)


class Pingable(Protocol):
    def ping(self) -> Awaitable[object]: ...


async def check_database(session: AsyncSession, timeout_s: float) -> CheckStatus:
    try:
        await asyncio.wait_for(session.execute(text("SELECT 1")), timeout=timeout_s)
    except Exception as exc:
        logger.warning("health_check_failed", extra={"check": "database", "error": repr(exc)})
        return "down"
    return "ok"


async def check_redis(redis: Pingable, timeout_s: float) -> CheckStatus:
    try:
        await asyncio.wait_for(redis.ping(), timeout=timeout_s)
    except Exception as exc:
        logger.warning("health_check_failed", extra={"check": "redis", "error": repr(exc)})
        return "down"
    return "ok"


def overall_status(checks: ReadinessChecks) -> OverallStatus:
    return "ok" if all(value == "ok" for value in checks.model_dump().values()) else "degraded"


async def readiness(
    session: AsyncSession, redis: Pingable, timeout_s: float
) -> tuple[OverallStatus, ReadinessChecks]:
    database, cache = await asyncio.gather(
        check_database(session, timeout_s),
        check_redis(redis, timeout_s),
    )
    checks = ReadinessChecks(database=database, redis=cache)
    return overall_status(checks), checks
