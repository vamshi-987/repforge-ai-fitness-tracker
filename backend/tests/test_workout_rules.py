"""Pure workout rules: records, totals, the edit window, cursors and request validation."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from pydantic import ValidationError
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.errors import AppError
from app.db.models import ExerciseType, RecordType, SetType, Workout
from app.schemas.workouts import WorkoutPut, WorkoutSetIn
from app.services.records import (
    Best,
    SessionExercise,
    SetPerf,
    counts_reps,
    detect_records,
    epley,
    exercise_bests,
    load_kind,
)
from app.services.stats import (
    ExerciseWork,
    SetLoad,
    bump_generation,
    generation_key,
    set_volume_kg,
    workout_totals,
)
from app.services.workouts import (
    build_exercises,
    decode_cursor,
    encode_cursor,
    is_editable,
    tree_key,
)

T0 = datetime(2026, 10, 1, 18, 0, tzinfo=UTC)
BENCH = uuid.uuid5(uuid.NAMESPACE_DNS, "bench")
DIP = uuid.uuid5(uuid.NAMESPACE_DNS, "dip")
CHEST = uuid.uuid5(uuid.NAMESPACE_DNS, "chest")
TRICEPS = uuid.uuid5(uuid.NAMESPACE_DNS, "triceps")
DELTS = uuid.uuid5(uuid.NAMESPACE_DNS, "delts")


def s(
    weight: float | None,
    reps: int | None,
    kind: SetType = SetType.NORMAL,
    done: bool = True,
    ident: int = 0,
) -> SetPerf:
    return SetPerf(uuid.UUID(int=ident), kind, weight, reps, done)


def values(bests: dict[RecordType, Best]) -> dict[RecordType, float]:
    return {kind: best.value for kind, best in bests.items()}


# --- e1RM and load kinds ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("weight", "reps", "expected"),
    [(100, 1, 103.333), (100, 10, 133.333), (60, 5, 70.0), (0, 5, None), (100, 0, None)],
)
def test_epley(weight: float, reps: int, expected: float | None) -> None:
    result = epley(weight, reps)
    assert (result if result is None else round(result, 3)) == expected


@pytest.mark.parametrize(
    ("kind", "load", "reps"),
    [
        (ExerciseType.WEIGHT_REPS, "load", True),
        (ExerciseType.BODYWEIGHT_REPS, None, True),
        (ExerciseType.WEIGHTED_BODYWEIGHT, "added", True),
        (ExerciseType.ASSISTED_BODYWEIGHT, "assist", True),
        (ExerciseType.DURATION, None, False),
        (ExerciseType.DISTANCE_DURATION, None, False),
    ],
)
def test_load_kinds(kind: ExerciseType, load: str | None, reps: bool) -> None:
    assert load_kind(kind) == load
    assert counts_reps(kind) is reps


# --- bests in one workout ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "sets", "expected"),
    [
        pytest.param(
            ExerciseType.WEIGHT_REPS,
            [s(100, 5), s(105, 3), s(90, 8)],
            {
                RecordType.HEAVIEST: 105,
                RecordType.E1RM: 116.67,  # 100 * (1 + 5/30)
                RecordType.BEST_SET_VOLUME: 720,  # 90 * 8
                RecordType.SESSION_VOLUME: 1535,
            },
            id="loaded lift",
        ),
        pytest.param(
            ExerciseType.WEIGHT_REPS,
            [s(140, 5, SetType.WARMUP), s(60, 5, done=False), s(100, 0), s(80, 5)],
            {
                RecordType.HEAVIEST: 80,
                RecordType.E1RM: 93.33,
                RecordType.BEST_SET_VOLUME: 400,
                RecordType.SESSION_VOLUME: 400,
            },
            id="warm-ups, unticked and zero-rep sets never count",
        ),
        pytest.param(
            ExerciseType.BODYWEIGHT_REPS,
            [s(None, 12), s(None, 15), s(None, 9)],
            {RecordType.MOST_REPS: 15},
            id="bodyweight",
        ),
        pytest.param(
            ExerciseType.WEIGHTED_BODYWEIGHT,
            [s(20, 8), s(25, 6)],
            {
                RecordType.HEAVIEST: 25,
                RecordType.BEST_SET_VOLUME: 160,
                RecordType.SESSION_VOLUME: 310,
                RecordType.MOST_REPS: 8,
            },
            id="weighted bodyweight: no e1RM",
        ),
        pytest.param(
            ExerciseType.ASSISTED_BODYWEIGHT,
            [s(30, 10), s(20, 8)],
            {RecordType.MOST_REPS: 10},
            id="assistance is not a load",
        ),
        pytest.param(
            ExerciseType.WEIGHTED_BODYWEIGHT,
            [s(None, 10)],
            {RecordType.MOST_REPS: 10},
            id="weighted bodyweight done without weight",
        ),
        pytest.param(ExerciseType.DURATION, [s(None, None)], {}, id="timed exercise"),
        pytest.param(ExerciseType.WEIGHT_REPS, [], {}, id="no sets"),
    ],
)
def test_exercise_bests(
    kind: ExerciseType, sets: list[SetPerf], expected: dict[RecordType, float]
) -> None:
    assert values(exercise_bests(kind, sets)) == expected


def test_a_tie_keeps_the_first_set() -> None:
    bests = exercise_bests(ExerciseType.WEIGHT_REPS, [s(100, 5, ident=1), s(100, 5, ident=2)])
    assert bests[RecordType.HEAVIEST].set_id == uuid.UUID(int=1)
    assert bests[RecordType.SESSION_VOLUME].set_id is None


# --- records across sessions ------------------------------------------------------------


def session(workout: int, sets: list[SetPerf], exercise: uuid.UUID = BENCH) -> SessionExercise:
    return SessionExercise(
        uuid.UUID(int=workout),
        exercise,
        ExerciseType.WEIGHT_REPS,
        T0 + timedelta(days=workout),
        sets,
    )


def heaviest(entries: list[Any]) -> list[tuple[int, float, float | None]]:
    return [
        (e.workout_id.int, e.value, e.previous)
        for e in entries
        if e.record_type == RecordType.HEAVIEST
    ]


def test_first_session_is_a_baseline_then_only_improvements_count() -> None:
    entries = detect_records(
        [session(1, [s(100, 5)]), session(2, [s(100, 5)]), session(3, [s(102.5, 5)])]
    )
    assert heaviest(entries) == [(1, 100, None), (3, 102.5, 100)]
    assert entries[0].achieved_at == T0 + timedelta(days=1)


def test_records_are_per_exercise() -> None:
    entries = detect_records(
        [session(1, [s(100, 5)]), session(1, [s(60, 5)], exercise=DIP), session(2, [s(70, 5)], DIP)]
    )
    assert [
        (e.exercise_id, e.value, e.previous) for e in entries if e.record_type == "heaviest"
    ] == [
        (BENCH, 100, None),
        (DIP, 60, None),
        (DIP, 70, 60),
    ]


def test_an_exercise_done_twice_in_a_workout_sets_a_record_once() -> None:
    entries = detect_records([session(1, [s(100, 5)]), session(1, [s(100, 5)])])
    assert heaviest(entries) == [(1, 100, None)]


# --- totals -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("kind", "set_", "expected"),
    [
        (ExerciseType.WEIGHT_REPS, SetLoad(SetType.NORMAL, 100, 5, True), 500),
        (ExerciseType.WEIGHT_REPS, SetLoad(SetType.WARMUP, 40, 10, True), 400),
        (ExerciseType.WEIGHT_REPS, SetLoad(SetType.NORMAL, 100, 5, False), 0),
        (ExerciseType.WEIGHTED_BODYWEIGHT, SetLoad(SetType.NORMAL, 20, 8, True), 160),
        (ExerciseType.ASSISTED_BODYWEIGHT, SetLoad(SetType.NORMAL, 30, 8, True), 0),
        (ExerciseType.BODYWEIGHT_REPS, SetLoad(SetType.NORMAL, None, 12, True), 0),
        (ExerciseType.WEIGHT_REPS, SetLoad(SetType.NORMAL, None, None, True), 0),
    ],
)
def test_set_volume(kind: ExerciseType, set_: SetLoad, expected: float) -> None:
    assert set_volume_kg(kind, set_) == expected


def test_workout_totals() -> None:
    totals = workout_totals(
        [
            ExerciseWork(
                ExerciseType.WEIGHT_REPS,
                CHEST,
                [TRICEPS, DELTS],
                [
                    SetLoad(SetType.WARMUP, 40, 10, True),
                    SetLoad(SetType.NORMAL, 80.125, 8, True),
                    SetLoad(SetType.NORMAL, 80, 8, True),
                    SetLoad(SetType.NORMAL, 80, 8, False),
                ],
            ),
            ExerciseWork(
                ExerciseType.BODYWEIGHT_REPS,
                TRICEPS,
                [CHEST],
                [SetLoad(SetType.NORMAL, None, 12, True)],
            ),
            # Only warm-ups: volume and sets, but no muscle sets.
            ExerciseWork(
                ExerciseType.WEIGHT_REPS, DELTS, [], [SetLoad(SetType.WARMUP, 10, 10, True)]
            ),
        ]
    )
    assert totals.volume_kg == 1781  # 400 + 641 + 640 + 100
    assert totals.completed_sets == 5
    assert totals.muscle_sets == {CHEST: 2.5, TRICEPS: 2.0, DELTS: 1.0}


# --- the edit window and cursors --------------------------------------------------------


@pytest.mark.parametrize(
    ("after_end", "editable"),
    [(timedelta(0), True), (timedelta(hours=24), True), (timedelta(hours=24, seconds=1), False)],
)
def test_editable_for_24_hours_after_the_end(after_end: timedelta, editable: bool) -> None:
    workout = Workout(started_at=T0 - timedelta(hours=1), ended_at=T0)
    assert is_editable(workout, T0 + after_end) is editable


def test_cursor_round_trip() -> None:
    ident = uuid.uuid4()
    assert decode_cursor(encode_cursor(T0, ident)) == (T0, ident)


@pytest.mark.parametrize(
    "cursor", ["", "not-base64!", "WzFd", "WyIyMDI2LTEwLTAxVDE4OjAwOjAwIiwgIngiXQ"]
)
def test_bad_cursors_are_rejected(cursor: str) -> None:
    with pytest.raises(AppError) as info:
        decode_cursor(cursor)
    assert info.value.code == "invalid_cursor"


# --- request validation and change detection --------------------------------------------


def body(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "  Push   Day ",
        "started_at": "2026-10-01T17:00:00Z",
        "ended_at": "2026-10-01T20:00:00+02:00",
        "exercises": [{"exercise_id": str(BENCH), "sets": [{"weight_kg": 80, "reps": 8}]}],
        **overrides,
    }


def test_workout_put_defaults() -> None:
    workout = WorkoutPut.model_validate(body())
    assert workout.title == "Push Day"
    assert workout.visibility == "private"
    assert workout.exercises[0].sets[0].completed is True


@pytest.mark.parametrize(
    "overrides",
    [
        {"ended_at": "2026-10-01T16:59:59Z"},
        {"ended_at": "2026-10-02T17:00:01Z"},
        {"started_at": "2026-10-01T17:00:00"},
        {"exercises": []},
        {"exercises": [{"exercise_id": str(BENCH), "sets": []}]},
        {"title": "   "},
        {"user_id": str(BENCH)},
    ],
)
def test_workout_put_rejects(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        WorkoutPut.model_validate(body(**overrides))


@pytest.mark.parametrize("rpe", [5.5, 8.5, 10])
def test_rpe_in_half_steps(rpe: float) -> None:
    assert WorkoutSetIn(rpe=rpe).rpe == rpe


@pytest.mark.parametrize("rpe", [0.5, 8.25, 10.5])
def test_rpe_out_of_range(rpe: float) -> None:
    with pytest.raises(ValidationError):
        WorkoutSetIn(rpe=rpe)


def test_tree_key_ignores_row_ids_and_rounds_weights() -> None:
    workout = WorkoutPut.model_validate(body())
    first = build_exercises(workout.exercises, [None])
    second = build_exercises(
        WorkoutPut.model_validate(
            body(
                exercises=[{"exercise_id": str(BENCH), "sets": [{"weight_kg": 80.004, "reps": 8}]}]
            )
        ).exercises,
        [None],
    )
    assert first[0].id != second[0].id
    assert tree_key(first) == tree_key(second)
    assert first[0].sets[0].weight_kg == 80.0


# --- stats cache generation -------------------------------------------------------------


async def test_saving_bumps_the_stats_generation() -> None:
    redis = FakeAsyncRedis(decode_responses=True)
    await bump_generation(redis, BENCH)
    await bump_generation(redis, BENCH)

    assert await redis.get(generation_key(BENCH)) == "2"


class DownRedis:
    async def incr(self, _: str) -> int:
        raise RedisConnectionError("redis is down")


async def test_a_redis_outage_never_fails_a_save() -> None:
    await bump_generation(DownRedis(), BENCH)  # type: ignore[arg-type]
