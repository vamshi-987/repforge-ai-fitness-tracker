import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.db.models import ExerciseType
from app.services.library_seed import (
    LibrarySeed,
    SeedCounts,
    SeedReport,
    library_id,
    library_problems,
    load_library,
)

# The SVG regions the mobile BodyMap draws (CLAUDE.md §8).
BODY_MAP_KEYS = {
    "chest", "front_delts", "side_delts", "rear_delts", "biceps", "triceps", "forearms", "abs",
    "obliques", "lats", "upper_back", "traps", "lower_back", "glutes", "quads", "hamstrings",
    "adductors", "abductors", "calves", "neck",
}  # fmt: skip


def tiny_library(**overrides: Any) -> dict[str, Any]:
    exercise = {
        "slug": "bench-press-barbell",
        "name": "Bench Press (Barbell)",
        "type": "weight_reps",
        "equipment": "barbell",
        "primary_muscle": "chest",
        "secondary_muscles": ["triceps"],
        "instructions": ["one", "two", "three"],
    }
    return {
        "muscles": [
            {"slug": "chest", "name": "Chest", "body_map_key": "chest"},
            {"slug": "triceps", "name": "Triceps", "body_map_key": "triceps"},
        ],
        "equipment": [{"slug": "barbell", "name": "Barbell", "increment_kg": 2.5}],
        "exercises": [{**exercise, **overrides}],
    }


# --- the real seed files ----------------------------------------------------------------


@pytest.fixture(scope="module")
def library() -> LibrarySeed:
    return load_library()


def test_seed_files_are_valid_and_complete(library: LibrarySeed) -> None:
    assert len(library.exercises) >= 400
    assert len(library.muscles) == 20
    assert 10 <= len(library.equipment) <= 15


def test_every_muscle_maps_to_a_body_map_region(library: LibrarySeed) -> None:
    assert {m.body_map_key for m in library.muscles} == BODY_MAP_KEYS


def test_every_muscle_is_trained_by_some_exercise(library: LibrarySeed) -> None:
    primaries = {ex.primary_muscle for ex in library.exercises}
    assert primaries == {m.slug for m in library.muscles}


def test_every_exercise_type_is_represented(library: LibrarySeed) -> None:
    assert {ex.type for ex in library.exercises} == set(ExerciseType)


def test_library_ships_without_media(library: LibrarySeed) -> None:
    # Option D (CLAUDE.md §1): no licensed loops yet, the app shows the red body map.
    assert all(ex.media_video_url is None for ex in library.exercises)


def test_bench_press_targets(library: LibrarySeed) -> None:
    bench = next(ex for ex in library.exercises if ex.slug == "bench-press-barbell")

    assert bench.primary_muscle == "chest"
    assert set(bench.secondary_muscles) == {"front_delts", "triceps"}


# --- ids --------------------------------------------------------------------------------


def test_library_ids_are_stable() -> None:
    # Pinned: changing the namespace or the format would orphan every stored reference
    # (workouts, routines and phones that mirrored the library).
    assert library_id("exercise", "bench-press-barbell") == uuid.UUID(
        "e7b40f5a-46df-5073-9161-a5081fb0e120"
    )


def test_library_ids_depend_on_kind_and_slug() -> None:
    assert library_id("muscle", "chest") != library_id("equipment", "chest")
    assert library_id("muscle", "chest") != library_id("muscle", "triceps")
    assert library_id("muscle", "chest").version == 5


# --- validation -------------------------------------------------------------------------


def test_tiny_library_is_valid() -> None:
    assert library_problems(LibrarySeed.model_validate(tiny_library())) == []


@pytest.mark.parametrize(
    ("overrides", "problem"),
    [
        ({"equipment": "sled"}, "unknown equipment 'sled'"),
        ({"primary_muscle": "wings"}, "unknown muscle 'wings'"),
        ({"secondary_muscles": ["chest"]}, "primary muscle is also listed as secondary"),
        ({"secondary_muscles": ["triceps", "triceps"]}, "secondary muscles repeat"),
        ({"instructions": ["one", "two"]}, "needs 3-5 instruction lines, has 2"),
        ({"instructions": ["x"] * 6}, "needs 3-5 instruction lines, has 6"),
        ({"media_video_url": "https://cdn/x.mp4"}, "media needs a media_license"),
    ],
)
def test_invalid_exercise(overrides: dict[str, Any], problem: str) -> None:
    with pytest.raises(ValidationError, match=problem):
        LibrarySeed.model_validate(tiny_library(**overrides))


def test_media_with_licence_is_fine() -> None:
    data = tiny_library(media_video_url="https://cdn/x.mp4", media_license="CC-BY-4.0 (Acme)")

    LibrarySeed.model_validate(data)


def test_duplicate_slugs_and_names_are_rejected() -> None:
    data = tiny_library()
    data["exercises"].append({**data["exercises"][0], "name": "BENCH PRESS (barbell)"})
    data["muscles"].append(data["muscles"][0])

    with pytest.raises(ValidationError) as err:
        LibrarySeed.model_validate(data)

    message = str(err.value)
    assert "duplicate exercise slug 'bench-press-barbell'" in message
    assert "duplicate exercise name 'bench press (barbell)'" in message
    assert "duplicate muscle slug 'chest'" in message


@pytest.mark.parametrize(
    "overrides",
    [{"slug": "Bench Press"}, {"type": "cardio"}, {"name": ""}, {"surprise": 1}],
)
def test_malformed_fields(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        LibrarySeed.model_validate(tiny_library(**overrides))


def test_load_library_reads_a_directory(tmp_path: Path) -> None:
    data = tiny_library()
    for name in ("muscles", "equipment", "exercises"):
        (tmp_path / f"{name}.json").write_text(json.dumps({name: data[name]}))

    library = load_library(tmp_path)

    assert [ex.slug for ex in library.exercises] == ["bench-press-barbell"]


# --- report -----------------------------------------------------------------------------


def test_report_summary_and_changed_flag() -> None:
    quiet = SeedReport(SeedCounts(unchanged=20), SeedCounts(unchanged=14), SeedCounts(unchanged=3))
    busy = SeedReport(
        SeedCounts(inserted=20), SeedCounts(unchanged=14), SeedCounts(updated=1, archived=2)
    )

    assert not quiet.changed
    assert busy.changed
    assert busy.summary() == (
        "muscles: 20 new, 0 updated, 0 unchanged\n"
        "equipment: 0 new, 0 updated, 14 unchanged\n"
        "exercises: 0 new, 1 updated, 0 unchanged, 2 archived"
    )


def test_empty_sections_are_rejected() -> None:
    data = tiny_library()
    data["exercises"] = []

    with pytest.raises(ValidationError):
        LibrarySeed.model_validate(data)
