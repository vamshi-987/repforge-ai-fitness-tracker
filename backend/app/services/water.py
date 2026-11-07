"""Water: drinks per local day against a goal of 35 ml per kg of body weight, plus 500 ml on
days with a workout (CLAUDE.md §4.2 C). A goal the user set replaces the 35 ml/kg base."""

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError
from app.db.change_lock import lock_changes
from app.db.models import User, WaterLog, Workout
from app.schemas.stats import StatsRange
from app.schemas.water import WaterDay, WaterDayTotal, WaterHistory, WaterIn, WaterLogOut
from app.services.body import commit_new, ensure_id_free
from app.services.profile import field_error, latest_weight_kg, load_profile
from app.services.stats import local_day
from app.services.workouts import CLOCK_SKEW

ML_PER_KG = 35
TRAINING_DAY_EXTRA_ML = 500
# Without a weigh-in (shouldn't happen after onboarding): roughly 70 kg.
FALLBACK_GOAL_ML = 2500


def daily_goal_ml(weight_kg: float | None, custom_goal_ml: int | None, trained: bool) -> int:
    """The base (the user's own goal, else 35 ml/kg rounded to 50 ml) plus 500 ml on a
    training day."""
    if custom_goal_ml is not None:
        base = custom_goal_ml
    elif weight_kg is None:
        base = FALLBACK_GOAL_ML
    else:
        base = round(ML_PER_KG * weight_kg / 50) * 50
    return base + (TRAINING_DAY_EXTRA_ML if trained else 0)


def day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """[start, end) of a local day as aware datetimes (DST-safe: each end is local midnight)."""
    return (
        datetime.combine(day, time(), tz),
        datetime.combine(day + timedelta(days=1), time(), tz),
    )


def parse_day(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise AppError(
            "validation_error",
            "Request is invalid",
            422,
            [{"loc": ["query", "date"], "msg": "use YYYY-MM-DD", "type": "value_error"}],
        ) from exc


# --- writes -----------------------------------------------------------------------------


async def put_water(
    session: AsyncSession,
    user: User,
    log_id: uuid.UUID,
    amount_ml: int,
    logged_at: datetime,
    now: datetime,
) -> WaterLogOut:
    """Create the drink, or set it to this state (the sync upsert). The caller has checked
    that an existing row is the user's own and not deleted."""
    if logged_at > now + CLOCK_SKEW:
        raise field_error("logged_at", "logged_at is in the future")
    await lock_changes(session, user.id)
    row = await session.get(WaterLog, log_id)
    if row is None:
        row = WaterLog(id=log_id, user_id=user.id, logged_at=logged_at, amount_ml=amount_ml)
        session.add(row)
        await commit_new(session, "water_log_exists")
    elif (row.logged_at, row.amount_ml) != (logged_at, amount_ml):
        row.logged_at = logged_at
        row.amount_ml = amount_ml
        row.version += 1
        await session.commit()
    return WaterLogOut.model_validate(row)


async def log_water(session: AsyncSession, user: User, body: WaterIn, now: datetime) -> WaterLogOut:
    await ensure_id_free(session, WaterLog, body.id, "water_log_exists")
    return await put_water(
        session, user, body.id or uuid.uuid4(), body.amount_ml, body.logged_at or now, now
    )


async def delete_water(session: AsyncSession, user: User, log_id: uuid.UUID, now: datetime) -> None:
    row = await session.get(WaterLog, log_id)
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise NotFoundError("Water log not found")
    row.deleted_at = now
    row.version += 1
    await session.commit()


# --- reads ------------------------------------------------------------------------------


async def _context(session: AsyncSession, user: User) -> tuple[ZoneInfo, int | None, float | None]:
    profile = await load_profile(session, user.id)
    return (
        ZoneInfo(profile.timezone),
        profile.water_goal_ml,
        await latest_weight_kg(session, user.id),
    )


async def _training_days(
    session: AsyncSession, user: User, start: datetime, end: datetime, tz: ZoneInfo
) -> set[date]:
    rows = await session.scalars(
        select(Workout.started_at).where(
            Workout.user_id == user.id,
            Workout.deleted_at.is_(None),
            Workout.started_at >= start,
            Workout.started_at < end,
        )
    )
    return {local_day(started, tz) for started in rows}


async def _logs(
    session: AsyncSession, user: User, start: datetime, end: datetime
) -> list[WaterLog]:
    return list(
        await session.scalars(
            select(WaterLog)
            .where(
                WaterLog.user_id == user.id,
                WaterLog.deleted_at.is_(None),
                WaterLog.logged_at >= start,
                WaterLog.logged_at < end,
            )
            .order_by(WaterLog.logged_at, WaterLog.id)
        )
    )


async def water_day(
    session: AsyncSession, user: User, day_text: str | None, now: datetime
) -> WaterDay:
    tz, custom, weight = await _context(session, user)
    day = parse_day(day_text) if day_text else local_day(now, tz)
    start, end = day_bounds(day, tz)
    logs = await _logs(session, user, start, end)
    trained = bool(await _training_days(session, user, start, end, tz))
    return WaterDay(
        date=day,
        goal_ml=daily_goal_ml(weight, custom, trained),
        total_ml=sum(log.amount_ml for log in logs),
        trained=trained,
        logs=[WaterLogOut.model_validate(log) for log in logs],
    )


async def water_history(
    session: AsyncSession, user: User, stats_range: StatsRange, now: datetime
) -> WaterHistory:
    """Every day of the range. The goal uses today's weight: the past isn't re-weighed."""
    tz, custom, weight = await _context(session, user)
    today = local_day(now, tz)
    span = stats_range.span or timedelta(days=365 * 5)
    first = local_day(now - span, tz)
    if stats_range.span is None:
        oldest = await session.scalar(
            select(WaterLog.logged_at)
            .where(WaterLog.user_id == user.id, WaterLog.deleted_at.is_(None))
            .order_by(WaterLog.logged_at)
            .limit(1)
        )
        first = local_day(oldest, tz) if oldest else today
    start, _ = day_bounds(first, tz)
    _, end = day_bounds(today, tz)
    totals: dict[date, int] = defaultdict(int)
    for log in await _logs(session, user, start, end):
        totals[local_day(log.logged_at, tz)] += log.amount_ml
    trained = await _training_days(session, user, start, end, tz)
    days = [first + timedelta(days=i) for i in range((today - first).days + 1)]
    return WaterHistory(
        days=[
            WaterDayTotal(
                date=day,
                total_ml=totals[day],
                goal_ml=daily_goal_ml(weight, custom, day in trained),
            )
            for day in days
        ]
    )
