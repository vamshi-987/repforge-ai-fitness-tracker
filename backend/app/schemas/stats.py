import uuid
from datetime import date, datetime, timedelta
from enum import StrEnum

from pydantic import BaseModel

from app.db.models import RecordType
from app.schemas.workouts import WorkoutSetOut


class StatsRange(StrEnum):
    """How far back charts look. Free accounts get up to 3 months (PLAN.md G5)."""

    MONTH = "1m"
    QUARTER = "3m"
    YEAR = "1y"
    ALL = "all"

    @property
    def span(self) -> timedelta | None:
        return {
            StatsRange.MONTH: timedelta(days=30),
            StatsRange.QUARTER: timedelta(days=91),
            StatsRange.YEAR: timedelta(days=365),
            StatsRange.ALL: None,
        }[self]

    @property
    def is_pro(self) -> bool:
        return self in (StatsRange.YEAR, StatsRange.ALL)


# --- one exercise ------------------------------------------------------------------------


class ExerciseSession(BaseModel):
    """One workout's sets of an exercise (an exercise done twice in a workout is merged)."""

    workout_id: uuid.UUID
    workout_title: str
    started_at: datetime
    sets: list[WorkoutSetOut]


class ExerciseHistoryPage(BaseModel):
    items: list[ExerciseSession]
    next_cursor: str | None


class ExercisePoint(BaseModel):
    """One session's numbers for the exercise charts; null where they don't apply."""

    workout_id: uuid.UUID
    started_at: datetime
    heaviest_kg: float | None
    e1rm_kg: float | None
    # The best e1RM came from a set of more than 12 reps: shown, but marked as rough.
    e1rm_low_accuracy: bool
    best_set_volume_kg: float | None
    session_volume_kg: float | None
    total_reps: int | None


class ExerciseRecordOut(BaseModel):
    record_type: RecordType
    value: float
    workout_id: uuid.UUID
    achieved_at: datetime


class ExerciseStatsOut(BaseModel):
    exercise_id: uuid.UUID
    range: StatsRange
    points: list[ExercisePoint]
    # Current all-time bests, whatever the range.
    records: list[ExerciseRecordOut]


# --- dashboard (GET /stats/*) -------------------------------------------------------------


class WeekStats(BaseModel):
    # Monday of the week, in the user's timezone.
    week_start: date
    workouts: int
    duration_s: int
    volume_kg: float
    sets: int


class StatsSummary(BaseModel):
    range: StatsRange
    workouts: int
    duration_s: int
    volume_kg: float
    sets: int
    # Oldest first, every week of the range (empty ones included).
    weeks: list[WeekStats]
    # Weeks in a row with at least one workout, up to this week.
    streak_weeks: int


class MuscleSets(BaseModel):
    slug: str
    name: str
    body_map_key: str
    sets: float


class MuscleStats(BaseModel):
    range: StatsRange
    # Most-trained first; muscles not trained in the range are left out.
    muscles: list[MuscleSets]


class CalendarDay(BaseModel):
    date: date
    workouts: int


class CalendarMonth(BaseModel):
    month: str
    # Only days with a workout.
    days: list[CalendarDay]
    streak_weeks: int
