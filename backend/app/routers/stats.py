from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import CurrentUser, DbSession, RedisClient
from app.schemas.stats import CalendarMonth, MuscleStats, StatsRange, StatsSummary
from app.services import dashboard

router = APIRouter(tags=["stats"])

RangeQuery = Annotated[StatsRange, Query(alias="range")]


@router.get("/stats/summary", response_model=StatsSummary)
async def summary(
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    stats_range: RangeQuery = StatsRange.QUARTER,
) -> StatsSummary:
    return await dashboard.summary(session, redis, user, stats_range, datetime.now(UTC))


@router.get("/stats/muscles", response_model=MuscleStats)
async def muscles(
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    stats_range: RangeQuery = StatsRange.MONTH,
) -> MuscleStats:
    return await dashboard.muscles(session, redis, user, stats_range, datetime.now(UTC))


@router.get("/stats/calendar", response_model=CalendarMonth)
async def month_calendar(
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    month: Annotated[str, Query(max_length=7)],
) -> CalendarMonth:
    return await dashboard.month_calendar(session, redis, user, month, datetime.now(UTC))
