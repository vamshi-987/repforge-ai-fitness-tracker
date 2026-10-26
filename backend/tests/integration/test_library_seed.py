import copy
import json
from pathlib import Path
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.commands.seed import run
from app.db.models import (
    AuthProvider,
    Equipment,
    Exercise,
    ExerciseType,
    Muscle,
    User,
    exercise_secondary_muscles,
)
from app.services.exercises import LIBRARY_VERSION_KEY
from app.services.library_seed import (
    LibrarySeed,
    SeedCounts,
    SeedError,
    apply_library,
    library_id,
    load_library,
)

pytestmark = pytest.mark.integration

Sessions = async_sessionmaker[AsyncSession]

BASE: dict[str, Any] = {
    "muscles": [
        {"slug": "chest", "name": "Chest", "body_map_key": "chest"},
        {"slug": "triceps", "name": "Triceps", "body_map_key": "triceps"},
        {"slug": "front_delts", "name": "Front Delts", "body_map_key": "front_delts"},
    ],
    "equipment": [
        {"slug": "barbell", "name": "Barbell", "increment_kg": 2.5},
        {"slug": "bodyweight", "name": "Bodyweight", "increment_kg": None},
    ],
    "exercises": [
        {
            "slug": "bench-press-barbell",
            "name": "Bench Press (Barbell)",
            "type": "weight_reps",
            "equipment": "barbell",
            "primary_muscle": "chest",
            "secondary_muscles": ["front_delts", "triceps"],
            "instructions": ["Lie down.", "Lower the bar.", "Press it up."],
        },
        {
            "slug": "push-up",
            "name": "Push-Up",
            "type": "bodyweight_reps",
            "equipment": "bodyweight",
            "primary_muscle": "chest",
            "secondary_muscles": ["triceps"],
            "instructions": ["Plank.", "Lower.", "Push."],
        },
    ],
}
BENCH = library_id("exercise", "bench-press-barbell")


@pytest.fixture(autouse=True)
async def empty_library(session_factory: Sessions) -> None:
    """Start from no library at all (another fixture may have committed one)."""
    async with session_factory() as session:
        await session.execute(delete(exercise_secondary_muscles))
        for model in (Exercise, Muscle, Equipment):
            await session.execute(delete(model))
        await session.commit()


def seed_data() -> dict[str, Any]:
    return copy.deepcopy(BASE)


def library(data: dict[str, Any]) -> LibrarySeed:
    return LibrarySeed.model_validate(data)


async def apply(sessions: Sessions, data: dict[str, Any]) -> Any:
    async with sessions() as session:
        return await apply_library(session, library(data))


async def load_exercise(sessions: Sessions, exercise_id: Any) -> Exercise:
    async with sessions() as session:
        exercise = await session.scalar(
            select(Exercise)
            .where(Exercise.id == exercise_id)
            .options(
                selectinload(Exercise.secondary_muscles),
                selectinload(Exercise.primary_muscle),
                selectinload(Exercise.equipment),
            )
        )
        assert exercise is not None
        return exercise


async def test_first_run_inserts_and_second_run_changes_nothing(
    session_factory: Sessions,
) -> None:
    first = await apply(session_factory, seed_data())
    second = await apply(session_factory, seed_data())

    assert first.exercises == SeedCounts(inserted=2)
    assert first.muscles == SeedCounts(inserted=3)
    assert first.equipment == SeedCounts(inserted=2)
    assert second.exercises == SeedCounts(unchanged=2)
    assert not second.changed

    bench = await load_exercise(session_factory, BENCH)
    assert bench.id == BENCH
    assert bench.owner_user_id is None
    assert bench.type is ExerciseType.WEIGHT_REPS
    assert bench.primary_muscle.slug == "chest"
    assert bench.equipment.increment_kg == 2.5
    assert [m.slug for m in bench.secondary_muscles] == ["front_delts", "triceps"]
    assert bench.instructions == ["Lie down.", "Lower the bar.", "Press it up."]
    assert bench.version == 1


async def test_a_changed_field_rewrites_only_that_row(session_factory: Sessions) -> None:
    await apply(session_factory, seed_data())
    data = seed_data()
    data["exercises"][0]["name"] = "Barbell Bench Press"
    data["equipment"][1]["name"] = "Body Weight"

    report = await apply(session_factory, data)

    assert report.exercises == SeedCounts(updated=1, unchanged=1)
    assert report.equipment == SeedCounts(updated=1, unchanged=1)
    bench = await load_exercise(session_factory, BENCH)
    assert (bench.name, bench.version) == ("Barbell Bench Press", 2)


async def test_secondary_muscle_changes_count_as_an_update(session_factory: Sessions) -> None:
    await apply(session_factory, seed_data())
    data = seed_data()
    data["exercises"][0]["secondary_muscles"] = ["triceps"]

    report = await apply(session_factory, data)

    assert report.exercises == SeedCounts(updated=1, unchanged=1)
    bench = await load_exercise(session_factory, BENCH)
    assert [m.slug for m in bench.secondary_muscles] == ["triceps"]
    assert bench.version == 2

    data["exercises"][0]["secondary_muscles"] = ["triceps", "front_delts"]
    report = await apply(session_factory, data)

    assert report.exercises == SeedCounts(updated=1, unchanged=1)
    bench = await load_exercise(session_factory, BENCH)
    assert [m.slug for m in bench.secondary_muscles] == ["front_delts", "triceps"]


async def test_exercises_leaving_the_seed_are_archived_then_restored(
    session_factory: Sessions,
) -> None:
    await apply(session_factory, seed_data())
    without_bench = seed_data()
    del without_bench["exercises"][0]

    removed = await apply(session_factory, without_bench)
    restored = await apply(session_factory, seed_data())

    assert removed.exercises == SeedCounts(unchanged=1, archived=1)
    assert restored.exercises == SeedCounts(updated=1, unchanged=1)
    bench = await load_exercise(session_factory, BENCH)
    assert bench.is_archived is False
    assert bench.version == 3


async def test_type_change_is_refused_and_nothing_is_written(session_factory: Sessions) -> None:
    await apply(session_factory, seed_data())
    data = seed_data()
    data["exercises"][0]["type"] = "duration"
    data["exercises"][1]["name"] = "Renamed"

    with pytest.raises(SeedError, match="'bench-press-barbell' is weight_reps in the database"):
        await apply(session_factory, data)

    push_up = await load_exercise(session_factory, library_id("exercise", "push-up"))
    assert push_up.name == "Push-Up"


async def test_custom_exercises_are_never_archived(session_factory: Sessions) -> None:
    await apply(session_factory, seed_data())
    async with session_factory() as session:
        user = User(
            email="custom@example.com",
            auth_provider=AuthProvider.PASSWORD,
            username="custom",
            display_name="Custom",
        )
        session.add(user)
        await session.flush()
        custom = Exercise(
            owner_user_id=user.id,
            name="My Press",
            type=ExerciseType.WEIGHT_REPS,
            equipment_id=library_id("equipment", "barbell"),
            primary_muscle_id=library_id("muscle", "chest"),
        )
        session.add(custom)
        await session.commit()
        custom_id = custom.id

    report = await apply(session_factory, seed_data())

    assert report.exercises.archived == 0
    mine = await load_exercise(session_factory, custom_id)
    assert mine.is_archived is False


async def test_full_library_loads_and_bench_search_uses_trigrams(
    session_factory: Sessions,
) -> None:
    full = load_library()
    async with session_factory() as session:
        report = await apply_library(session, full)

    assert report.exercises.inserted == len(full.exercises)
    assert report.muscles.inserted == 20

    async with session_factory() as session:
        names = (
            await session.scalars(
                select(Exercise.name)
                .where(Exercise.name.ilike("%bench%"))
                .order_by(func.word_similarity("bench", Exercise.name).desc(), Exercise.name)
            )
        ).all()
        chest = await session.scalar(select(Muscle).where(Muscle.slug == "chest"))

    assert "Bench Press (Barbell)" in names
    assert len(names) >= 10
    assert chest is not None and chest.id == library_id("muscle", "chest")

    bench = await load_exercise(session_factory, BENCH)
    assert bench.primary_muscle.body_map_key == "chest"
    assert {m.body_map_key for m in bench.secondary_muscles} == {"front_delts", "triceps"}


async def test_seed_command_busts_the_library_cache_only_on_change(
    session_factory: Sessions, fake_redis: FakeAsyncRedis, tmp_path: Path
) -> None:
    for name in ("muscles", "equipment", "exercises"):
        (tmp_path / f"{name}.json").write_text(json.dumps({name: BASE[name]}))
    await fake_redis.set(LIBRARY_VERSION_KEY, "old")

    report = await run(session_factory, fake_redis, tmp_path)

    assert report.exercises == SeedCounts(inserted=2)
    assert await fake_redis.get(LIBRARY_VERSION_KEY) is None

    await fake_redis.set(LIBRARY_VERSION_KEY, "current")
    await run(session_factory, fake_redis, tmp_path)

    assert await fake_redis.get(LIBRARY_VERSION_KEY) == "current"
