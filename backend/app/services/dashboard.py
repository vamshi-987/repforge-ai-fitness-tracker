"""The profile dashboard: training summary by week, sets per muscle, and the calendar.

Everything reads the aggregates stored on each workout (totals, `workout_muscle_sets`), never
raw sets. Weeks and days are in the user's timezone. Results are cached in Redis for 10
minutes under the user's stats generation, which every workout save bumps (stats.py).
"""

import calendar
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.models import Muscle, User, Workout, workout_muscle_sets
from app.schemas.stats import (
    CalendarDay,
    CalendarMonth,
    MuscleSets,
    MuscleStats,
    StatsRange,
    StatsSummary,
    WeekStats,
)
from app.services.pro import ensure_pro
from app.services.profile import load_profile
from app.services.stats import (
    WorkoutMark,
    daily_counts,
    generation_key,
    local_day,
    streak_weeks,
    week_start,
    weekly_buckets,
)

logger = logging.getLogger(__name__)

CACHE_TTL_S = 600


async def _cached[Model: BaseModel](
    redis: Redis,
    user_id: uuid.UUID,
    key: str,
    model: type[Model],
    compute: Callable[[], Awaitable[Model]],
) -> Model:
    """Read through the cache; Redis trouble means computing, never failing."""
    try:
        generation = await redis.get(generation_key(user_id)) or "0"
        full_key = f"stats:{user_id}:{generation}:{key}"
        hit = await redis.get(full_key)
    except RedisError as exc:
        logger.warning("cache_unavailable", extra={"key": key, "error": repr(exc)})
        return await compute()
    if hit is not None:
        return model.model_validate_json(hit)
    value = await compute()
    try:
        await redis.set(full_key, value.model_dump_json(), ex=CACHE_TTL_S)
    except RedisError as exc:
        logger.warning("cache_unavailable", extra={"key": key, "error": repr(exc)})
    return value


def _check_range(user: User, stats_range: StatsRange) -> None:
    if stats_range.is_pro:
        ensure_pro(user, "Stats longer than 3 months")


async def _timezone(session: AsyncSession, user: User) -> ZoneInfo:
    # Stored values are checked against the tz database on write (profile service).
    return ZoneInfo((await load_profile(session, user.id)).timezone)


async def _marks(
    session: AsyncSession, user: User, since: datetime | None, until: datetime | None = None
) -> list[WorkoutMark]:
    query = select(
        Workout.started_at, Workout.ended_at, Workout.total_volume_kg, Workout.total_sets
    ).where(Workout.user_id == user.id, Workout.deleted_at.is_(None))
    if since is not None:
        query = query.where(Workout.started_at >= since)
    if until is not None:
        query = query.where(Workout.started_at < until)
    return [
        WorkoutMark(start, int((end - start).total_seconds()), volume, sets)
        for start, end, volume, sets in await session.execute(query)
    ]


async def _streak(session: AsyncSession, user: User, tz: ZoneInfo, today: date) -> int:
    trained = {
        week_start(local_day(mark.started_at, tz)) for mark in await _marks(session, user, None)
    }
    return streak_weeks(trained, week_start(today))


async def summary(
    session: AsyncSession, redis: Redis, user: User, stats_range: StatsRange, now: datetime
) -> StatsSummary:
    _check_range(user, stats_range)

    async def compute() -> StatsSummary:
        tz = await _timezone(session, user)
        today = local_day(now, tz)
        span = stats_range.span
        marks = await _marks(session, user, None if span is None else now - span)
        first: date | None = (
            week_start(local_day(now - span, tz))
            if span is not None
            else min((week_start(local_day(m.started_at, tz)) for m in marks), default=None)
        )
        weeks = weekly_buckets(marks, first or week_start(today), week_start(today), tz)
        return StatsSummary(
            range=stats_range,
            workouts=sum(b.workouts for b in weeks.values()),
            duration_s=sum(b.duration_s for b in weeks.values()),
            volume_kg=round(sum(b.volume_kg for b in weeks.values()), 2),
            sets=sum(b.sets for b in weeks.values()),
            weeks=[
                WeekStats(
                    week_start=week,
                    workouts=b.workouts,
                    duration_s=b.duration_s,
                    volume_kg=b.volume_kg,
                    sets=b.sets,
                )
                for week, b in weeks.items()
            ],
            streak_weeks=await _streak(session, user, tz, today),
        )

    return await _cached(redis, user.id, f"summary:{stats_range}", StatsSummary, compute)


async def muscles(
    session: AsyncSession, redis: Redis, user: User, stats_range: StatsRange, now: datetime
) -> MuscleStats:
    _check_range(user, stats_range)

    async def compute() -> MuscleStats:
        total = func.sum(workout_muscle_sets.c.sets)
        query = (
            select(Muscle.slug, Muscle.name, Muscle.body_map_key, total)
            .join(workout_muscle_sets, workout_muscle_sets.c.muscle_id == Muscle.id)
            .join(Workout, Workout.id == workout_muscle_sets.c.workout_id)
            .where(Workout.user_id == user.id, Workout.deleted_at.is_(None))
            .group_by(Muscle.slug, Muscle.name, Muscle.body_map_key)
            .order_by(total.desc(), Muscle.slug)
        )
        if stats_range.span is not None:
            query = query.where(Workout.started_at >= now - stats_range.span)
        return MuscleStats(
            range=stats_range,
            muscles=[
                MuscleSets(slug=slug, name=name, body_map_key=key, sets=float(sets))
                for slug, name, key, sets in await session.execute(query)
            ],
        )

    return await _cached(redis, user.id, f"muscles:{stats_range}", MuscleStats, compute)


def parse_month(month: str) -> tuple[int, int]:
    """ "2026-10" → (2026, 10)."""
    try:
        year_text, month_text = month.split("-")
        year, number = int(year_text), int(month_text)
        if len(year_text) != 4 or len(month_text) != 2 or not 1 <= number <= 12:
            raise ValueError
    except ValueError as exc:
        raise AppError(
            "validation_error",
            "Request is invalid",
            422,
            [{"loc": ["query", "month"], "msg": "use YYYY-MM", "type": "value_error"}],
        ) from exc
    return year, number


async def month_calendar(
    session: AsyncSession, redis: Redis, user: User, month: str, now: datetime
) -> CalendarMonth:
    year, number = parse_month(month)

    async def compute() -> CalendarMonth:
        tz = await _timezone(session, user)
        first = date(year, number, 1)
        after = first + timedelta(days=calendar.monthrange(year, number)[1])
        # A day's workouts can start up to 14 hours either side of UTC midnight.
        start = datetime(year, number, 1, tzinfo=tz) - timedelta(days=1)
        end = datetime(after.year, after.month, after.day, tzinfo=tz) + timedelta(days=1)
        counts = daily_counts(await _marks(session, user, start, end), tz)
        return CalendarMonth(
            month=f"{year:04d}-{number:02d}",
            days=[
                CalendarDay(date=day, workouts=n)
                for day, n in sorted(counts.items())
                if first <= day < after
            ],
            streak_weeks=await _streak(session, user, tz, local_day(now, tz)),
        )

    return await _cached(
        redis, user.id, f"calendar:{year:04d}-{number:02d}", CalendarMonth, compute
    )
