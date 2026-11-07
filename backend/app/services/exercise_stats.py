"""One exercise's history and chart data, read from the user's saved workouts."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.db.models import Exercise, PersonalRecord, User, Workout, WorkoutExercise, WorkoutSet
from app.schemas.stats import (
    ExerciseHistoryPage,
    ExercisePoint,
    ExerciseRecordOut,
    ExerciseSession,
    ExerciseStatsOut,
    StatsRange,
)
from app.schemas.workouts import WorkoutSetOut
from app.services.pro import ensure_pro
from app.services.records import SetPerf
from app.services.stats import session_point
from app.services.workouts import decode_cursor, encode_cursor


async def _exercise(session: AsyncSession, user: User, exercise_id: uuid.UUID) -> Exercise:
    """A library exercise or one of the user's own; a deleted custom exercise keeps its
    history."""
    exercise = await session.get(Exercise, exercise_id)
    if exercise is None or exercise.owner_user_id not in (None, user.id):
        raise NotFoundError("Exercise not found")
    return exercise


def _sets_query(user: User, exercise_id: uuid.UUID) -> Any:
    return (
        select(Workout.id, Workout.title, Workout.started_at, WorkoutSet)
        .join(WorkoutExercise, WorkoutExercise.workout_id == Workout.id)
        .join(WorkoutSet, WorkoutSet.workout_exercise_id == WorkoutExercise.id)
        .where(
            Workout.user_id == user.id,
            Workout.deleted_at.is_(None),
            WorkoutExercise.exercise_id == exercise_id,
        )
    )


def _group(rows: Any) -> list[tuple[uuid.UUID, str, datetime, list[WorkoutSet]]]:
    """Rows ordered by workout → one entry per workout, its sets in order."""
    sessions: dict[uuid.UUID, tuple[uuid.UUID, str, datetime, list[WorkoutSet]]] = {}
    for workout_id, title, started_at, workout_set in rows:
        sessions.setdefault(workout_id, (workout_id, title, started_at, []))[3].append(workout_set)
    return list(sessions.values())


async def exercise_history(
    session: AsyncSession,
    user: User,
    exercise_id: uuid.UUID,
    *,
    cursor: str | None,
    limit: int,
) -> ExerciseHistoryPage:
    """The user's sessions of this exercise, newest first."""
    await _exercise(session, user, exercise_id)
    # Page by workout first, so a page never splits a workout's sets.
    pick = (
        select(Workout.id, Workout.started_at)
        .join(WorkoutExercise, WorkoutExercise.workout_id == Workout.id)
        .where(
            Workout.user_id == user.id,
            Workout.deleted_at.is_(None),
            WorkoutExercise.exercise_id == exercise_id,
        )
        .group_by(Workout.id, Workout.started_at)
        .order_by(Workout.started_at.desc(), Workout.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        started_at, workout_id = decode_cursor(cursor)
        pick = pick.where(tuple_(Workout.started_at, Workout.id) < tuple_(started_at, workout_id))
    picked = list(await session.execute(pick))
    page = picked[:limit]
    rows = await session.execute(
        _sets_query(user, exercise_id)
        .where(Workout.id.in_([row.id for row in page]))
        .order_by(
            Workout.started_at.desc(),
            Workout.id.desc(),
            WorkoutExercise.position,
            WorkoutSet.position,
        )
    )
    last = page[-1] if page else None
    return ExerciseHistoryPage(
        items=[
            ExerciseSession(
                workout_id=workout_id,
                workout_title=title,
                started_at=started_at,
                sets=[
                    WorkoutSetOut(
                        id=s.id,
                        set_type=s.set_type,
                        weight_kg=s.weight_kg,
                        reps=s.reps,
                        duration_s=s.duration_s,
                        distance_m=s.distance_m,
                        rpe=s.rpe,
                        completed=s.completed,
                    )
                    for s in sets
                ],
            )
            for workout_id, title, started_at, sets in _group(rows)
        ],
        next_cursor=(
            encode_cursor(last.started_at, last.id) if last and len(picked) > limit else None
        ),
    )


async def exercise_stats(
    session: AsyncSession,
    user: User,
    exercise_id: uuid.UUID,
    stats_range: StatsRange,
    now: datetime,
) -> ExerciseStatsOut:
    """One point per session in the range, oldest first, and the all-time records."""
    if stats_range.is_pro:
        ensure_pro(user, "Charts longer than 3 months")
    exercise = await _exercise(session, user, exercise_id)
    query = _sets_query(user, exercise_id).order_by(
        Workout.started_at, Workout.id, WorkoutExercise.position, WorkoutSet.position
    )
    if stats_range.span is not None:
        query = query.where(Workout.started_at >= now - stats_range.span)
    points = []
    for workout_id, _, started_at, sets in _group(await session.execute(query)):
        point = session_point(
            exercise.type,
            [SetPerf(s.id, s.set_type, s.weight_kg, s.reps, s.completed) for s in sets],
        )
        points.append(
            ExercisePoint(
                workout_id=workout_id,
                started_at=started_at,
                heaviest_kg=point.heaviest_kg,
                e1rm_kg=point.e1rm_kg,
                e1rm_low_accuracy=point.e1rm_low_accuracy,
                best_set_volume_kg=point.best_set_volume_kg,
                session_volume_kg=point.session_volume_kg,
                total_reps=point.total_reps,
            )
        )

    # The highest record of each type is the current best; ties are never records, so it
    # is unique.
    best = (
        select(PersonalRecord.record_type, func.max(PersonalRecord.value).label("value"))
        .where(PersonalRecord.user_id == user.id, PersonalRecord.exercise_id == exercise_id)
        .group_by(PersonalRecord.record_type)
        .subquery()
    )
    records = await session.scalars(
        select(PersonalRecord)
        .join(
            best,
            (best.c.record_type == PersonalRecord.record_type)
            & (best.c.value == PersonalRecord.value),
        )
        .where(PersonalRecord.user_id == user.id, PersonalRecord.exercise_id == exercise_id)
        .order_by(PersonalRecord.record_type)
    )
    return ExerciseStatsOut(
        exercise_id=exercise_id,
        range=stats_range,
        points=points,
        records=[
            ExerciseRecordOut(
                record_type=r.record_type,
                value=r.value,
                workout_id=r.workout_id,
                achieved_at=r.achieved_at,
            )
            for r in records
        ],
    )
