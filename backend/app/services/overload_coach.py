"""Suggestions per exercise: reads the history, asks `overload.py`, and adds a sentence on why.

A suggestion stands until the exercise has a newer session or the rep range changes, so starting
a routine twice costs nothing. The LLM never touches the target.
"""

import asyncio
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.ai.client import AiClient
from app.ai.coach_tips import OverloadFacts, explain_overload
from app.core.errors import NotFoundError
from app.db.models import (
    Exercise,
    OverloadSuggestion,
    SetType,
    User,
    Workout,
    WorkoutExercise,
    WorkoutSet,
)
from app.schemas.coach import OverloadList, OverloadOut, TargetSetOut
from app.services.overload import DoneSet, Plan, Suggestion, suggest
from app.services.profile import load_profile
from app.services.routines import get_routine

DEFAULT_REP_RANGE = (8, 12)
HISTORY_SESSIONS = 6
SHOWN_TO_LLM = 3
WORKING_SETS = (SetType.NORMAL, SetType.FAILURE)

RepRange = tuple[int, int]


def _working(sets: list[WorkoutSet]) -> list[DoneSet]:
    return [
        DoneSet(s.weight_kg, s.reps, s.rpe)
        for s in sets
        if s.completed and s.set_type in WORKING_SETS and s.reps
    ]


async def _history(
    session: AsyncSession, user: User, exercise_id: uuid.UUID
) -> tuple[list[list[DoneSet]], datetime | None]:
    """Working sets per workout, newest first, and when the newest ended."""
    rows = await session.execute(
        select(WorkoutExercise, Workout.ended_at)
        .join(Workout, Workout.id == WorkoutExercise.workout_id)
        .where(
            Workout.user_id == user.id,
            Workout.deleted_at.is_(None),
            WorkoutExercise.exercise_id == exercise_id,
        )
        .options(selectinload(WorkoutExercise.sets))
        .order_by(Workout.ended_at.desc(), WorkoutExercise.position)
        # An exercise can appear twice in one workout; those rows are one session.
        .limit(HISTORY_SESSIONS * 2)
    )
    by_workout: dict[uuid.UUID, list[DoneSet]] = {}
    latest: datetime | None = None
    for row, ended_at in rows:
        latest = latest or ended_at
        by_workout.setdefault(row.workout_id, []).extend(_working(row.sets))
    return list(by_workout.values())[:HISTORY_SESSIONS], latest


async def _latest(
    session: AsyncSession, user: User, exercise_id: uuid.UUID
) -> OverloadSuggestion | None:
    row: OverloadSuggestion | None = await session.scalar(
        select(OverloadSuggestion)
        .where(OverloadSuggestion.user_id == user.id, OverloadSuggestion.exercise_id == exercise_id)
        .order_by(OverloadSuggestion.generated_at.desc())
        .limit(1)
    )
    return row


def _target_json(suggestion: Suggestion, rep_range: RepRange) -> dict[str, Any]:
    return {
        "sets": [asdict(s) for s in suggestion.sets],
        "rep_min": rep_range[0],
        "rep_max": rep_range[1],
        "e1rm_kg": suggestion.e1rm_kg,
        "e1rm_low_accuracy": suggestion.e1rm_low_accuracy,
    }


def _out(row: OverloadSuggestion) -> OverloadOut:
    target = row.target_json
    return OverloadOut(
        exercise_id=row.exercise_id,
        rule=row.rule,
        sets=[TargetSetOut(**s) for s in target["sets"]],
        rep_min=target["rep_min"],
        rep_max=target["rep_max"],
        e1rm_kg=target["e1rm_kg"],
        e1rm_low_accuracy=target["e1rm_low_accuracy"],
        explanation=row.explanation,
        generated_at=row.generated_at,
    )


@dataclass(frozen=True)
class _Fresh:
    exercise: Exercise
    rep_range: RepRange
    suggestion: Suggestion
    facts: OverloadFacts


def _facts(
    exercise: Exercise,
    rep_range: RepRange,
    sessions: list[list[DoneSet]],
    suggestion: Suggestion,
) -> OverloadFacts:
    return OverloadFacts(
        exercise=exercise.name,
        rule=suggestion.rule,
        rep_range=rep_range,
        last_sessions=[[asdict(s) for s in sets] for sets in sessions[:SHOWN_TO_LLM]],
        target_sets=[asdict(s) for s in suggestion.sets],
    )


async def _prepare(
    session: AsyncSession, user: User, exercise: Exercise, rep_range: RepRange
) -> OverloadOut | _Fresh | None:
    """A stored suggestion that still holds, or a new one still needing its sentence."""
    sessions, last_ended = await _history(session, user, exercise.id)
    if last_ended is None:
        return None
    stored = await _latest(session, user, exercise.id)
    same_range = stored is not None and (
        (stored.target_json["rep_min"], stored.target_json["rep_max"]) == rep_range
    )
    if stored is not None and same_range and stored.generated_at >= last_ended:
        return _out(stored)
    profile = await load_profile(session, user.id)
    suggestion = suggest(
        sessions,
        Plan(
            exercise_type=exercise.type,
            rep_min=rep_range[0],
            rep_max=rep_range[1],
            increment_kg=exercise.equipment.increment_kg,
            unit=profile.unit_weight,
            previous_rule=stored.rule if stored else None,
        ),
    )
    if suggestion is None:
        return None
    return _Fresh(
        exercise, rep_range, suggestion, _facts(exercise, rep_range, sessions, suggestion)
    )


async def _finish(
    session: AsyncSession,
    ai: AiClient,
    user: User,
    prepared: list[OverloadOut | _Fresh | None],
    now: datetime,
) -> list[OverloadOut]:
    fresh = [p for p in prepared if isinstance(p, _Fresh)]
    user_id = user.id
    # Reads are done: no transaction stays open during the LLM calls.
    await session.commit()
    explanations = await asyncio.gather(*(explain_overload(ai, f.facts) for f in fresh))
    stored = {}
    for item, explanation in zip(fresh, explanations, strict=True):
        row = OverloadSuggestion(
            user_id=user_id,
            exercise_id=item.exercise.id,
            generated_at=now,
            rule=item.suggestion.rule,
            target_json=_target_json(item.suggestion, item.rep_range),
            explanation=explanation,
        )
        session.add(row)
        stored[id(item)] = row
    await session.commit()
    return [_out(stored[id(p)]) if isinstance(p, _Fresh) else p for p in prepared if p is not None]


async def _exercises(
    session: AsyncSession, user: User, ids: set[uuid.UUID]
) -> dict[uuid.UUID, Exercise]:
    rows = await session.scalars(
        select(Exercise).where(Exercise.id.in_(ids)).options(joinedload(Exercise.equipment))
    )
    return {e.id: e for e in rows if e.deleted_at is None and e.owner_user_id in (None, user.id)}


async def for_exercise(
    session: AsyncSession,
    ai: AiClient,
    user: User,
    exercise_id: uuid.UUID,
    rep_range: RepRange,
    now: datetime,
) -> OverloadOut | None:
    exercise = (await _exercises(session, user, {exercise_id})).get(exercise_id)
    if exercise is None:
        raise NotFoundError("Exercise not found")
    prepared = await _prepare(session, user, exercise, rep_range)
    items = await _finish(session, ai, user, [prepared], now)
    return items[0] if items else None


async def for_routine(
    session: AsyncSession, ai: AiClient, user: User, routine_id: uuid.UUID, now: datetime
) -> OverloadList:
    """One suggestion per exercise; one listed twice uses its first rep range."""
    routine = await get_routine(session, user, routine_id)
    ranges: dict[uuid.UUID, RepRange] = {}
    for item in routine.exercises:
        ranges.setdefault(
            item.exercise_id,
            (
                item.rep_range_min or DEFAULT_REP_RANGE[0],
                item.rep_range_max or DEFAULT_REP_RANGE[1],
            ),
        )
    exercises = await _exercises(session, user, set(ranges))
    prepared = [
        await _prepare(session, user, exercises[exercise_id], rep_range)
        for exercise_id, rep_range in ranges.items()
        if exercise_id in exercises
    ]
    return OverloadList(items=await _finish(session, ai, user, prepared, now))
