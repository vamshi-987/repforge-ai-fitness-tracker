"""Personal records: pure functions over a user's sessions, in the order they happened.

The rules match the app's (mobile `src/workout/records.ts`), so a record the phone celebrates
offline is the one the server stores. Warm-up sets never count.

Records are a function of the whole history: the server recomputes them for the exercises a
save touches, walking every session in start-time order. A workout that reaches the server
late (logged offline, synced days later) therefore lands in its rightful place, and a later
workout that was a "record" only because the earlier one was missing loses that status.
"""

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.db.models import ExerciseType, RecordType, SetType
from app.services.profile import round_half_up

# How a set's weight is meant: the load lifted, weight added to bodyweight, or assistance
# taken off bodyweight. None = no weight at all.
LoadKind = Literal["load", "added", "assist"] | None

_LOAD: dict[ExerciseType, LoadKind] = {
    ExerciseType.WEIGHT_REPS: "load",
    ExerciseType.BODYWEIGHT_REPS: None,
    ExerciseType.WEIGHTED_BODYWEIGHT: "added",
    ExerciseType.ASSISTED_BODYWEIGHT: "assist",
    ExerciseType.DURATION: None,
    ExerciseType.DISTANCE_DURATION: None,
}
_COUNTS_REPS = frozenset(
    {
        ExerciseType.WEIGHT_REPS,
        ExerciseType.BODYWEIGHT_REPS,
        ExerciseType.WEIGHTED_BODYWEIGHT,
        ExerciseType.ASSISTED_BODYWEIGHT,
    }
)


def load_kind(exercise_type: ExerciseType) -> LoadKind:
    return _LOAD[exercise_type]


def counts_reps(exercise_type: ExerciseType) -> bool:
    return exercise_type in _COUNTS_REPS


def epley(weight_kg: float, reps: int) -> float | None:
    """Estimated one-rep max: w * (1 + reps / 30) (CLAUDE.md §10)."""
    if weight_kg <= 0 or reps <= 0:
        return None
    return weight_kg * (1 + reps / 30)


@dataclass(frozen=True)
class SetPerf:
    id: uuid.UUID
    set_type: SetType
    weight_kg: float | None
    reps: int | None
    completed: bool


@dataclass(frozen=True)
class Best:
    value: float
    # The set that reached it; None for whole-session records.
    set_id: uuid.UUID | None


def _keep_max(
    bests: dict[RecordType, Best], kind: RecordType, value: float | None, set_id: uuid.UUID
) -> None:
    if value is None or value <= 0:
        return
    current = bests.get(kind)
    # Strictly greater: on a tie the earlier set keeps the record.
    if current is None or value > current.value:
        bests[kind] = Best(round_half_up(value, 2), set_id)


def exercise_bests(exercise_type: ExerciseType, sets: Sequence[SetPerf]) -> dict[RecordType, Best]:
    """The best values one exercise reached in one workout.

    Loaded exercises track heaviest weight and volume (and e1RM for plain loads); exercises
    done for reps without a plain load track the most reps in a set.
    """
    load = load_kind(exercise_type)
    bests: dict[RecordType, Best] = {}
    session = 0.0
    for s in sets:
        reps = s.reps or 0
        if not s.completed or s.set_type == SetType.WARMUP or reps <= 0:
            continue
        weight = s.weight_kg or 0.0
        if load in ("load", "added"):
            _keep_max(bests, RecordType.HEAVIEST, weight, s.id)
            _keep_max(bests, RecordType.BEST_SET_VOLUME, weight * reps, s.id)
            session += weight * reps
        if load == "load":
            _keep_max(bests, RecordType.E1RM, epley(weight, reps), s.id)
        if counts_reps(exercise_type) and load != "load":
            _keep_max(bests, RecordType.MOST_REPS, reps, s.id)
    if session > 0:
        bests[RecordType.SESSION_VOLUME] = Best(round_half_up(session, 2), None)
    return bests


@dataclass(frozen=True)
class SessionExercise:
    """One exercise as done in one workout."""

    workout_id: uuid.UUID
    exercise_id: uuid.UUID
    exercise_type: ExerciseType
    achieved_at: datetime
    sets: Sequence[SetPerf]


@dataclass(frozen=True)
class RecordEntry:
    workout_id: uuid.UUID
    exercise_id: uuid.UUID
    record_type: RecordType
    value: float
    # The best before this one; None = the first value (a baseline, not a PR).
    previous: float | None
    set_id: uuid.UUID | None
    achieved_at: datetime


def detect_records(history: Iterable[SessionExercise]) -> list[RecordEntry]:
    """Every new best in `history`, which must be in the order it happened (workout start
    time, then position in the workout). An exercise done twice in a workout is compared
    with itself too, so it can't set the same record twice."""
    known: dict[tuple[uuid.UUID, RecordType], float] = {}
    entries: list[RecordEntry] = []
    for item in history:
        for kind, best in exercise_bests(item.exercise_type, item.sets).items():
            key = (item.exercise_id, kind)
            previous = known.get(key)
            if previous is not None and best.value <= previous:
                continue
            known[key] = best.value
            entries.append(
                RecordEntry(
                    workout_id=item.workout_id,
                    exercise_id=item.exercise_id,
                    record_type=kind,
                    value=best.value,
                    previous=previous,
                    set_id=best.set_id,
                    achieved_at=item.achieved_at,
                )
            )
    return entries
