import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.db.models import SetType, User
from app.schemas.routines import (
    MAX_ROUTINE_EXERCISES,
    MAX_SETS_PER_EXERCISE,
    FolderCreate,
    RoutineCreate,
    RoutineExerciseIn,
    RoutineReorder,
    RoutineUpdate,
)
from app.services.routines import (
    SupersetError,
    build_exercises,
    copy_exercises,
    normalize_supersets,
    routine_limit,
    tree_key,
)

BENCH = uuid.uuid5(uuid.NAMESPACE_DNS, "bench")
ROW = uuid.uuid5(uuid.NAMESPACE_DNS, "row")


# --- supersets --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("groups", "expected"),
    [
        ([], []),
        ([None, None], [None, None]),
        ([1, 1], [1, 1]),
        # Renumbered in order of appearance.
        ([7, 7, None, 3, 3, 3], [1, 1, None, 2, 2, 2]),
        ([2, 2, 1, 1], [1, 1, 2, 2]),
        # One-exercise groups are not supersets.
        ([5], [None]),
        ([1, None, 2, 2], [None, None, 1, 1]),
        ([1, 2, 2, 3], [None, 1, 1, None]),
    ],
)
def test_normalize_supersets(groups: list[int | None], expected: list[int | None]) -> None:
    assert normalize_supersets(groups) == expected


@pytest.mark.parametrize(
    ("groups", "index"),
    [
        ([1, 1, None, 1], 3),
        ([1, 2, 1], 2),
        # Even a lone stray member counts: the user meant it to join group 1.
        ([1, 1, 2, 2, 1, 1], 4),
    ],
)
def test_superset_members_must_be_adjacent(groups: list[int | None], index: int) -> None:
    with pytest.raises(SupersetError) as caught:
        normalize_supersets(groups)

    assert caught.value.index == index


# --- limits -----------------------------------------------------------------------------


@pytest.mark.parametrize(("is_pro", "expected"), [(False, 4), (True, None)])
def test_routine_limit(is_pro: bool, expected: int | None) -> None:
    user = User(is_pro=is_pro)

    assert routine_limit(user, Settings(free_routine_limit=4)) == expected


# --- schemas ----------------------------------------------------------------------------


def exercise(**overrides: Any) -> dict[str, Any]:
    return {"exercise_id": str(BENCH), **overrides}


def test_routine_create_defaults_and_cleanup() -> None:
    body = RoutineCreate.model_validate(
        {"name": "  Push   Day ", "notes": "  heavy week  ", "exercises": [exercise()]}
    )

    assert body.name == "Push Day"
    assert body.notes == "heavy week"
    assert body.folder_id is None
    (item,) = body.exercises
    assert item.sets == []
    assert item.notes == ""
    assert item.rest_seconds is None


@pytest.mark.parametrize(
    "payload",
    [
        {"name": ""},
        {"name": "x" * 81},
        {"name": "A", "notes": "x" * 2001},
        {"name": "A", "unknown": 1},
        {"name": "A", "exercises": [exercise(rep_range_min=12, rep_range_max=8)]},
        {"name": "A", "exercises": [exercise(rep_range_min=0)]},
        {"name": "A", "exercises": [exercise(rest_seconds=901)]},
        {"name": "A", "exercises": [exercise(superset_group=0)]},
        {"name": "A", "exercises": [exercise(sets=[{"set_type": "heavy"}])]},
        {"name": "A", "exercises": [exercise(sets=[{"target_weight_kg": -1}])]},
        {"name": "A", "exercises": [exercise(sets=[{"target_reps": 1001}])]},
        {"name": "A", "exercises": [exercise(sets=[{"target_duration_s": 86401}])]},
        {"name": "A", "exercises": [exercise(sets=[{}] * (MAX_SETS_PER_EXERCISE + 1))]},
        {"name": "A", "exercises": [exercise()] * (MAX_ROUTINE_EXERCISES + 1)},
    ],
)
def test_routine_create_rejects(payload: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        RoutineCreate.model_validate(payload)


def test_equal_rep_range_bounds_are_fine() -> None:
    item = RoutineExerciseIn.model_validate(exercise(rep_range_min=5, rep_range_max=5))

    assert (item.rep_range_min, item.rep_range_max) == (5, 5)


def test_routine_update_only_folder_can_be_cleared() -> None:
    assert RoutineUpdate.model_validate({"folder_id": None}).model_fields_set == {"folder_id"}
    for field in ("name", "notes", "exercises"):
        with pytest.raises(ValidationError):
            RoutineUpdate.model_validate({field: None})


def test_reorder_ids_must_be_distinct() -> None:
    with pytest.raises(ValidationError):
        RoutineReorder.model_validate({"routine_ids": [str(BENCH), str(BENCH)]})


def test_folder_name_is_collapsed_and_bounded() -> None:
    assert FolderCreate.model_validate({"name": " Upper   body "}).name == "Upper body"
    with pytest.raises(ValidationError):
        FolderCreate.model_validate({"name": "x" * 61})


# --- building the tree ------------------------------------------------------------------


def items() -> list[RoutineExerciseIn]:
    return [
        RoutineExerciseIn.model_validate(
            exercise(
                superset_group=1,
                rep_range_min=8,
                rep_range_max=12,
                sets=[
                    {"set_type": "warmup", "target_weight_kg": 40.005, "target_reps": 10},
                    {"target_weight_kg": 60, "target_reps": 8},
                ],
            )
        ),
        RoutineExerciseIn.model_validate({"exercise_id": str(ROW), "superset_group": 1}),
    ]


def test_build_exercises_numbers_positions_and_rounds_weights() -> None:
    built = build_exercises(items(), [1, 1])

    assert [e.position for e in built] == [0, 1]
    assert [e.superset_group for e in built] == [1, 1]
    bench = built[0]
    assert [s.position for s in bench.sets] == [0, 1]
    assert [s.set_type for s in bench.sets] == [SetType.WARMUP, SetType.NORMAL]
    # Half-up to the column's 2 decimals, not float rounding.
    assert bench.sets[0].target_weight_kg == 40.01
    assert len({e.id for e in built} | {s.id for s in bench.sets}) == 4


def test_copy_has_the_same_content_and_new_ids() -> None:
    source = build_exercises(items(), [1, 1])

    copy = copy_exercises(source)

    assert tree_key(copy) == tree_key(source)
    assert {e.id for e in copy}.isdisjoint({e.id for e in source})
    assert {s.id for s in copy[0].sets}.isdisjoint({s.id for s in source[0].sets})


def test_tree_key_sees_set_changes() -> None:
    source = build_exercises(items(), [1, 1])
    changed = build_exercises(items(), [1, 1])
    changed[0].sets[1].target_reps = 9

    assert tree_key(build_exercises(items(), [1, 1])) == tree_key(source)
    assert tree_key(changed) != tree_key(source)
