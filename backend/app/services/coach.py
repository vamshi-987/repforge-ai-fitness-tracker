"""The weekly report: gathers a week of data, runs the engine, and asks for tips. The engine in
`nutrition_engine.py` decides every number; targets change only when the user applies a report.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import asdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AiClient
from app.ai.coach_tips import WeekFacts, weekly_tips
from app.core.errors import ConflictError, NotFoundError
from app.db.models import (
    BodyWeight,
    FoodLog,
    OverloadSuggestion,
    TargetReason,
    User,
    UserProfile,
    WeeklyReport,
    Workout,
)
from app.schemas.coach import SuggestedTargets, WeeklyReportOut
from app.schemas.nutrition import TargetsOut
from app.services import nutrition
from app.services.body import WeighIn, weekly_averages
from app.services.nutrition_engine import (
    ADAPTIVE_WINDOW_DAYS,
    RATE_RANGE_PCT,
    DailyTargets,
    WeekInput,
    WeekResult,
    WeekStatus,
    adaptive_tdee,
    bmr_mifflin,
    needs_check_in,
    rate_pct,
    tdee,
    weekly_adjustment,
)
from app.services.profile import age_on, field_error, load_profile, round_half_up
from app.services.push import Notification, Notify
from app.services.stats import local_day, week_start

logger = logging.getLogger(__name__)

REPORT_HOUR = 6
MONDAY = 0
# Three weeks of weigh-ins: this one, the one before, and the one before that for the check-in.
WEEKS_OF_WEIGHT = 3


def is_report_hour(now: datetime, tz: ZoneInfo) -> bool:
    """Monday 06:xx where the user lives (PLAN.md G6)."""
    local = now.astimezone(tz)
    return local.weekday() == MONDAY and local.hour == REPORT_HOUR


def last_full_week(now: datetime, tz: ZoneInfo) -> date:
    return week_start(local_day(now, tz)) - timedelta(days=7)


def _local_midnight(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)


async def _weekly_weights(
    session: AsyncSession, user: User, week: date, tz: ZoneInfo
) -> dict[date, tuple[float | None, int]]:
    """Monday → (average, weigh-ins) for the report's week and the two before it."""
    start = week - timedelta(days=7 * (WEEKS_OF_WEIGHT - 1))
    rows = await session.execute(
        select(BodyWeight.measured_at, BodyWeight.weight_kg).where(
            BodyWeight.user_id == user.id,
            BodyWeight.deleted_at.is_(None),
            BodyWeight.measured_at >= _local_midnight(start, tz),
            BodyWeight.measured_at < _local_midnight(week + timedelta(days=7), tz),
        )
    )
    weeks = weekly_averages((WeighIn(r.measured_at, r.weight_kg) for r in rows), tz)
    return {w.week_start: (w.average_kg, w.weigh_ins) for w in weeks}


async def _daily_intake(
    session: AsyncSession, user: User, first: date, last: date
) -> dict[date, tuple[float, float]]:
    """Logged days only: day → (kcal, protein)."""
    rows = await session.execute(
        select(FoodLog.log_date, func.sum(FoodLog.kcal), func.sum(FoodLog.protein_g))
        .where(
            FoodLog.user_id == user.id,
            FoodLog.deleted_at.is_(None),
            FoodLog.log_date >= first,
            FoodLog.log_date <= last,
        )
        .group_by(FoodLog.log_date)
    )
    return {day: (float(kcal), float(protein)) for day, kcal, protein in rows}


async def _workouts_in(session: AsyncSession, user: User, week: date, tz: ZoneInfo) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(Workout)
        .where(
            Workout.user_id == user.id,
            Workout.deleted_at.is_(None),
            Workout.started_at >= _local_midnight(week, tz),
            Workout.started_at < _local_midnight(week + timedelta(days=7), tz),
        )
    )
    return count or 0


async def _lift_progress(
    session: AsyncSession, user: User, week: date, tz: ZoneInfo
) -> dict[str, int]:
    rows = await session.execute(
        select(OverloadSuggestion.rule, func.count())
        .where(
            OverloadSuggestion.user_id == user.id,
            OverloadSuggestion.generated_at >= _local_midnight(week, tz),
            OverloadSuggestion.generated_at < _local_midnight(week + timedelta(days=7), tz),
        )
        .group_by(OverloadSuggestion.rule)
    )
    return {rule.value: count for rule, count in rows}


def _estimated_tdee(profile: UserProfile, weight_kg: float, today: date) -> int | None:
    if (
        profile.sex is None
        or profile.birth_date is None
        or profile.height_cm is None
        or profile.activity_level is None
    ):
        return None
    age = age_on(profile.birth_date, today)
    bmr = bmr_mifflin(profile.sex, weight_kg, profile.height_cm, age)
    return round(tdee(bmr, profile.activity_level))


def _mean(values: Sequence[float]) -> float | None:
    return round_half_up(sum(values) / len(values), 1) if values else None


def _as_dict(targets: DailyTargets | None) -> dict[str, int] | None:
    return asdict(targets) if targets else None


async def _build(
    session: AsyncSession, ai: AiClient, user: User, week: date, now: datetime
) -> dict[str, Any]:
    """Every column of the report, from the data as it stands."""
    profile = await load_profile(session, user.id)
    tz = ZoneInfo(profile.timezone)
    today = local_day(now, tz)
    weights = await _weekly_weights(session, user, week, tz)
    average, weigh_ins = weights.get(week, (None, 0))
    previous = weights.get(week - timedelta(days=7), (None, 0))[0]
    earlier = weights.get(week - timedelta(days=14), (None, 0))[0]
    last_day = week + timedelta(days=6)
    intake = await _daily_intake(
        session, user, last_day - timedelta(days=ADAPTIVE_WINDOW_DAYS - 1), last_day
    )
    this_week = [v for day, v in intake.items() if day >= week]
    week_kcal = [kcal for kcal, _ in this_week]
    targets = await nutrition.targets_for(session, user, today, today)
    current = (
        DailyTargets(targets.kcal, targets.protein_g, targets.carbs_g, targets.fat_g)
        if targets
        else None
    )
    goal = profile.goal
    experience = profile.experience

    result: WeekResult | None = None
    check_in = False
    if average is not None and previous is not None and current and goal and experience:
        rate = rate_pct(average, previous)
        earlier_rate = rate_pct(previous, earlier) if earlier is not None else None
        check_in = needs_check_in(week_kcal, rate, earlier_rate)
        result = weekly_adjustment(
            WeekInput(
                goal=goal,
                experience=experience,
                average_kg=average,
                previous_kg=previous,
                current=current,
                floor_kcal=await nutrition.minimum_kcal(session, user, today),
                check_in=check_in,
            )
        )
    else:
        check_in = needs_check_in(week_kcal, None, None)

    measured = None
    if result is not None:
        measured = adaptive_tdee([kcal for kcal, _ in intake.values()], result.change_kg)
    estimate = _estimated_tdee(profile, average, today) if average is not None else None
    low, high = RATE_RANGE_PCT[goal] if goal else (0.0, 0.0)
    status = result.status if result else WeekStatus.INSUFFICIENT_DATA
    avg_kcal = _mean(week_kcal)
    avg_protein = _mean([protein for _, protein in this_week])
    workouts = await _workouts_in(session, user, week, tz)
    lift_progress = await _lift_progress(session, user, week, tz)
    floor_hit = result.floor_hit if result else False
    suggested = _as_dict(result.targets) if result else None
    rate_out = round_half_up(result.rate_pct, 2) if result else None

    # Reads are done: no transaction stays open during the LLM call.
    await session.commit()
    tips, ai_written = await weekly_tips(
        ai,
        WeekFacts(
            goal=goal.value if goal else "unknown",
            experience=experience.value if experience else "unknown",
            weekly_avg=average,
            prev_avg=previous,
            rate_pct=rate_out,
            target_rate_range=(low, high),
            status=status,
            old_targets=_as_dict(current),
            new_targets=suggested,
            avg_protein_g=avg_protein,
            avg_kcal_logged=avg_kcal,
            days_logged=len(this_week),
            workouts_this_week=workouts,
            check_in=check_in,
            floor_hit=floor_hit,
            lift_progress=lift_progress,
        ),
    )
    return {
        "avg_weight_kg": average,
        "prev_avg_weight_kg": previous,
        "rate_pct": rate_out,
        "status": status.value,
        "suggested_targets": suggested,
        "headline": tips.headline,
        "tips": tips.tips,
        "details": {
            "change_kg": round_half_up(result.change_kg, 2) if result else None,
            "target_rate_min_pct": low,
            "target_rate_max_pct": high,
            "weigh_ins": weigh_ins,
            "current_targets": _as_dict(current),
            "delta_kcal": result.delta_kcal if result else 0,
            "tdee_kcal": measured if measured is not None else estimate,
            "tdee_source": (
                "adaptive" if measured is not None else "estimate" if estimate else None
            ),
            "avg_kcal_logged": avg_kcal,
            "avg_protein_g": avg_protein,
            "days_logged": len(this_week),
            "workouts": workouts,
            "check_in": check_in,
            "floor_hit": floor_hit,
            "ai_written": ai_written,
        },
    }


def report_out(row: WeeklyReport) -> WeeklyReportOut:
    details = row.details
    current = details["current_targets"]
    suggested = row.suggested_targets
    return WeeklyReportOut(
        id=row.id,
        week_start=row.week_start,
        status=WeekStatus(row.status),
        avg_weight_kg=row.avg_weight_kg,
        prev_avg_weight_kg=row.prev_avg_weight_kg,
        change_kg=details["change_kg"],
        rate_pct=row.rate_pct,
        target_rate_min_pct=details["target_rate_min_pct"],
        target_rate_max_pct=details["target_rate_max_pct"],
        weigh_ins=details["weigh_ins"],
        current_targets=SuggestedTargets(**current) if current else None,
        suggested_targets=SuggestedTargets(**suggested) if suggested else None,
        delta_kcal=details["delta_kcal"],
        tdee_kcal=details["tdee_kcal"],
        tdee_source=details["tdee_source"],
        avg_kcal_logged=details["avg_kcal_logged"],
        avg_protein_g=details["avg_protein_g"],
        days_logged=details["days_logged"],
        workouts=details["workouts"],
        check_in=details["check_in"],
        floor_hit=details["floor_hit"],
        headline=row.headline,
        tips=row.tips,
        ai_written=details["ai_written"],
        applied=row.applied,
        created_at=row.created_at,
    )


async def _existing(session: AsyncSession, user: User, week: date) -> WeeklyReport | None:
    report: WeeklyReport | None = await session.scalar(
        select(WeeklyReport).where(WeeklyReport.user_id == user.id, WeeklyReport.week_start == week)
    )
    return report


def _check_week(week: date, latest: date) -> None:
    if week.weekday() != MONDAY:
        raise field_error("week", "a week is named by its Monday")
    if week > latest:
        raise field_error("week", "that week isn't over yet")


async def weekly_report(
    session: AsyncSession, ai: AiClient, user: User, week: date | None, now: datetime
) -> WeeklyReportOut:
    """The report for a finished week, computed the first time it's asked for. A week that
    lacked data is recomputed, because the missing weigh-ins may have been added since."""
    tz = ZoneInfo((await load_profile(session, user.id)).timezone)
    latest = last_full_week(now, tz)
    wanted = week or latest
    _check_week(wanted, latest)
    user_id = user.id
    row = await _existing(session, user, wanted)
    if row is not None and row.status != WeekStatus.INSUFFICIENT_DATA:
        return report_out(row)

    fields = await _build(session, ai, user, wanted, now)
    row = await _existing(session, user, wanted)
    if row is None:
        row = WeeklyReport(user_id=user_id, week_start=wanted, **fields)
        session.add(row)
    else:
        for name, value in fields.items():
            setattr(row, name, value)
    try:
        await session.commit()
    except IntegrityError:
        # The hourly job and the app got here together; the other's row is the same report.
        await session.rollback()
        await session.refresh(user)
        row = await _existing(session, user, wanted)
        assert row is not None, f"no weekly report for {user_id} after a unique violation"
    return report_out(row)


async def apply_report(
    session: AsyncSession, user: User, report_id: uuid.UUID, now: datetime
) -> TargetsOut:
    """Make a report's targets the user's, from today. Applying twice changes nothing."""
    row = await session.get(WeeklyReport, report_id)
    if row is None or row.user_id != user.id:
        raise NotFoundError("Report not found")
    if row.suggested_targets is None:
        raise ConflictError("report_has_no_targets", "This report has no targets to apply")
    tz = ZoneInfo((await load_profile(session, user.id)).timezone)
    today = local_day(now, tz)
    if row.applied:
        current = await nutrition.targets_for(session, user, today, today)
        assert current is not None, "an applied report left targets behind"
        return current
    row.applied = True
    return await nutrition.write_targets(
        session, user, today, row.suggested_targets, TargetReason.WEEKLY_ADJUSTMENT
    )


async def due_users(session: AsyncSession, now: datetime) -> list[User]:
    """Pro users (the coach is Pro, PLAN.md G5) whose local time is Monday 06:xx."""
    rows = await session.execute(
        select(User, UserProfile.timezone)
        .join(UserProfile, UserProfile.user_id == User.id)
        .where(User.is_pro.is_(True), User.deleted_at.is_(None))
    )
    return [user for user, timezone in rows if is_report_hour(now, ZoneInfo(timezone))]


async def generate_due_reports(
    session: AsyncSession, ai: AiClient, now: datetime, notify: Notify
) -> int:
    """The hourly job. One user's failure doesn't stop the others'."""
    done = 0
    for user in await due_users(session, now):
        user_id = user.id
        try:
            report = await weekly_report(session, ai, user, None, now)
        except Exception:
            logger.exception("weekly_report_failed", extra={"user_id": str(user_id)})
            await session.rollback()
            continue
        done += 1
        if report.status != WeekStatus.INSUFFICIENT_DATA:
            notify(
                Notification(
                    user_id=user_id,
                    title="Your weekly report is ready",
                    body=report.headline,
                    path="/coach/weekly",
                )
            )
    return done
