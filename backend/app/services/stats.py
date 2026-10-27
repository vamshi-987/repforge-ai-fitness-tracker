"""Workout aggregates and the per-user stats cache.

Totals and sets per muscle are computed once, when a workout is saved, and stored on the
workout (CLAUDE.md §3, decision 5), so charts never scan raw sets.
"""

import logging
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.db.models import ExerciseType, SetType
from app.services.profile import round_half_up
from app.services.records import load_kind

logger = logging.getLogger(__name__)

# Each muscle a working set trains counts this much: the primary fully, secondaries half.
PRIMARY_SET = 1.0
SECONDARY_SET = 0.5


@dataclass(frozen=True)
class SetLoad:
    set_type: SetType
    weight_kg: float | None
    reps: int | None
    completed: bool


def set_volume_kg(exercise_type: ExerciseType, s: SetLoad) -> float:
    """weight * reps for a completed set with a load (added weight counts, assistance doesn't).
    Warm-ups count: volume describes the work done, records describe top performance."""
    if not s.completed or load_kind(exercise_type) not in ("load", "added"):
        return 0.0
    return (s.weight_kg or 0.0) * (s.reps or 0)


@dataclass(frozen=True)
class ExerciseWork:
    exercise_type: ExerciseType
    primary_muscle_id: uuid.UUID
    secondary_muscle_ids: Sequence[uuid.UUID]
    sets: Sequence[SetLoad]


@dataclass(frozen=True)
class WorkoutTotals:
    volume_kg: float
    completed_sets: int
    # Muscle id → sets (primary 1, secondary 0.5 per completed working set).
    muscle_sets: dict[uuid.UUID, float]


def workout_totals(exercises: Iterable[ExerciseWork]) -> WorkoutTotals:
    volume = 0.0
    completed = 0
    muscles: dict[uuid.UUID, float] = {}
    for exercise in exercises:
        working = 0
        for s in exercise.sets:
            volume += set_volume_kg(exercise.exercise_type, s)
            if s.completed:
                completed += 1
                if s.set_type != SetType.WARMUP:
                    working += 1
        if working == 0:
            continue
        primary = exercise.primary_muscle_id
        muscles[primary] = muscles.get(primary, 0.0) + working * PRIMARY_SET
        for muscle in exercise.secondary_muscle_ids:
            muscles[muscle] = muscles.get(muscle, 0.0) + working * SECONDARY_SET
    return WorkoutTotals(round_half_up(volume, 2), completed, muscles)


# --- cache invalidation -------------------------------------------------------------------
# Cached stats live under keys that contain the user's stats generation. Saving or deleting
# a workout bumps the generation, so every cached range for that user is unreachable at once
# (and expires on its own) without scanning Redis for keys.


def generation_key(user_id: uuid.UUID) -> str:
    return f"stats:{user_id}:gen"


async def bump_generation(redis: Redis, user_id: uuid.UUID) -> None:
    try:
        await redis.incr(generation_key(user_id))
    except RedisError as exc:
        # Fails open: stats would be up to 10 minutes stale, never wrong for longer.
        logger.warning(
            "cache_unavailable", extra={"key": generation_key(user_id), "error": repr(exc)}
        )
