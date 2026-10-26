"""The global exercise library: load `seeds/*.json`, validate it, and upsert it idempotently.

Every library row gets a UUIDv5 derived from its slug, so the same seed produces the same IDs
on every machine and every run. Re-running the seed changes nothing unless the files changed:
rows are only rewritten when a value differs, so `updated_at` (and the library ETag built on
it) only moves when the library really changed.
"""

import json
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Self, cast

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import (
    ColumnElement,
    Table,
    delete,
    func,
    literal_column,
    select,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Equipment, Exercise, ExerciseType, Muscle, exercise_secondary_muscles

DEFAULT_SEEDS_DIR = Path(__file__).resolve().parents[2] / "seeds"

# Never change this: every library ID is derived from it.
LIBRARY_NAMESPACE = uuid.UUID("5b1f6f2e-6f0e-4e43-9a4c-2a7c4b1d9e01")

MIN_INSTRUCTIONS = 3
MAX_INSTRUCTIONS = 5

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+([_-][a-z0-9]+)*$", max_length=80)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


def library_id(kind: str, slug: str) -> uuid.UUID:
    return uuid.uuid5(LIBRARY_NAMESPACE, f"{kind}:{slug}")


class _SeedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class MuscleSeed(_SeedModel):
    slug: Slug
    name: Name
    body_map_key: Slug


class EquipmentSeed(_SeedModel):
    slug: Slug
    name: Name
    increment_kg: Annotated[float, Field(gt=0, le=50)] | None


class ExerciseSeed(_SeedModel):
    slug: Slug
    name: Name
    type: ExerciseType
    equipment: Slug
    primary_muscle: Slug
    secondary_muscles: list[Slug] = []
    instructions: list[Annotated[str, StringConstraints(min_length=1, max_length=300)]]
    media_video_url: str | None = None
    media_thumb_url: str | None = None
    media_license: str | None = None


class LibrarySeed(_SeedModel):
    muscles: Annotated[list[MuscleSeed], Field(min_length=1)]
    equipment: Annotated[list[EquipmentSeed], Field(min_length=1)]
    exercises: Annotated[list[ExerciseSeed], Field(min_length=1)]

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        problems = library_problems(self)
        if problems:
            raise ValueError("; ".join(problems))
        return self


def _duplicates(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    dupes: list[str] = []
    for value in values:
        if value in seen and value not in dupes:
            dupes.append(value)
        seen.add(value)
    return dupes


def library_problems(library: LibrarySeed) -> list[str]:
    """Every reason the seed would be unsafe to load; empty when it is fine."""
    problems: list[str] = []
    for label, values in (
        ("muscle slug", (m.slug for m in library.muscles)),
        ("equipment slug", (e.slug for e in library.equipment)),
        ("exercise slug", (x.slug for x in library.exercises)),
        # Case-insensitive: "Push-Up" and "push-up" would look identical in the app.
        ("exercise name", (x.name.casefold() for x in library.exercises)),
    ):
        problems += [f"duplicate {label} {value!r}" for value in _duplicates(values)]

    muscles = {m.slug for m in library.muscles}
    equipment = {e.slug for e in library.equipment}
    for ex in library.exercises:
        where = f"exercise {ex.slug!r}"
        if ex.equipment not in equipment:
            problems.append(f"{where}: unknown equipment {ex.equipment!r}")
        for slug in [ex.primary_muscle, *ex.secondary_muscles]:
            if slug not in muscles:
                problems.append(f"{where}: unknown muscle {slug!r}")
        if ex.primary_muscle in ex.secondary_muscles:
            problems.append(f"{where}: primary muscle is also listed as secondary")
        if _duplicates(ex.secondary_muscles):
            problems.append(f"{where}: secondary muscles repeat")
        if not MIN_INSTRUCTIONS <= len(ex.instructions) <= MAX_INSTRUCTIONS:
            problems.append(
                f"{where}: needs {MIN_INSTRUCTIONS}-{MAX_INSTRUCTIONS} instruction lines,"
                f" has {len(ex.instructions)}"
            )
        # CLAUDE.md §13: no media in production without a recorded licence.
        if (ex.media_video_url or ex.media_thumb_url) and not ex.media_license:
            problems.append(f"{where}: media needs a media_license")
    return problems


def load_library(seeds_dir: Path = DEFAULT_SEEDS_DIR) -> LibrarySeed:
    def read(name: str) -> Any:
        return json.loads((seeds_dir / f"{name}.json").read_text(encoding="utf-8"))[name]

    return LibrarySeed.model_validate(
        {"muscles": read("muscles"), "equipment": read("equipment"), "exercises": read("exercises")}
    )


# --- applying ----------------------------------------------------------------------------


class SeedError(Exception):
    """The seed conflicts with what is already in the database; nothing was written."""


@dataclass(frozen=True)
class SeedCounts:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    archived: int = 0


@dataclass(frozen=True)
class SeedReport:
    muscles: SeedCounts
    equipment: SeedCounts
    exercises: SeedCounts

    @property
    def changed(self) -> bool:
        return any(
            c.inserted or c.updated or c.archived
            for c in (self.muscles, self.equipment, self.exercises)
        )

    def summary(self) -> str:
        def line(label: str, c: SeedCounts) -> str:
            text = f"{label}: {c.inserted} new, {c.updated} updated, {c.unchanged} unchanged"
            return text + (f", {c.archived} archived" if c.archived else "")

        return "\n".join(
            [
                line("muscles", self.muscles),
                line("equipment", self.equipment),
                line("exercises", self.exercises),
            ]
        )


def _changed(columns: Sequence[ColumnElement[Any]], excluded: Any) -> ColumnElement[bool]:
    """`(a, b) IS DISTINCT FROM (excluded.a, excluded.b)`: true only if some value differs."""
    return tuple_(*columns).is_distinct_from(tuple_(*(excluded[c.key] for c in columns)))


async def _upsert(
    session: AsyncSession,
    model: type[Muscle] | type[Equipment] | type[Exercise],
    rows: list[dict[str, Any]],
    compare: list[str],
) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """Insert new rows and rewrite changed ones. Returns (inserted ids, updated ids)."""
    table = cast(Table, model.__table__)
    insert = pg_insert(table).values(rows)
    columns = [table.c[name] for name in compare]
    values: dict[str, Any] = {name: insert.excluded[name] for name in compare}
    values["updated_at"] = func.now()
    if "version" in table.c:
        values["version"] = table.c.version + 1
    upsert = insert.on_conflict_do_update(
        index_elements=[table.c.id], set_=values, where=_changed(columns, insert.excluded)
    ).returning(table.c.id, literal_column("xmax = 0").label("inserted"))
    # Unchanged rows match the conflict but fail the WHERE, so they are not returned.
    result = (await session.execute(upsert)).all()
    inserted = {row.id for row in result if row.inserted}
    return inserted, {row.id for row in result if not row.inserted}


async def _sync_secondary_muscles(
    session: AsyncSession, desired: dict[uuid.UUID, set[uuid.UUID]]
) -> set[uuid.UUID]:
    """Make each exercise's secondary muscles match `desired`; returns exercises that changed."""
    link = exercise_secondary_muscles
    existing: dict[uuid.UUID, set[uuid.UUID]] = {exercise_id: set() for exercise_id in desired}
    rows = await session.execute(
        select(link.c.exercise_id, link.c.muscle_id).where(link.c.exercise_id.in_(desired))
    )
    for exercise_id, muscle_id in rows.all():
        existing[exercise_id].add(muscle_id)

    to_add = [
        {"exercise_id": exercise_id, "muscle_id": muscle_id}
        for exercise_id, muscles in desired.items()
        for muscle_id in muscles - existing[exercise_id]
    ]
    to_remove = [
        (exercise_id, muscle_id)
        for exercise_id, muscles in existing.items()
        for muscle_id in muscles - desired[exercise_id]
    ]
    if to_add:
        await session.execute(pg_insert(link).values(to_add))
    if to_remove:
        await session.execute(
            delete(link).where(tuple_(link.c.exercise_id, link.c.muscle_id).in_(to_remove))
        )
    return {row["exercise_id"] for row in to_add} | {exercise_id for exercise_id, _ in to_remove}


async def _type_conflicts(session: AsyncSession, library: LibrarySeed) -> list[str]:
    wanted = {library_id("exercise", ex.slug): ex for ex in library.exercises}
    stored = await session.execute(
        select(Exercise.id, Exercise.type).where(Exercise.id.in_(wanted))
    )
    return [
        f"exercise {wanted[row.id].slug!r} is {row.type.value} in the database"
        f" but {wanted[row.id].type.value} in the seed"
        for row in stored.all()
        if row.type != wanted[row.id].type
    ]


async def apply_library(session: AsyncSession, library: LibrarySeed) -> SeedReport:
    """Upsert the whole library in one transaction and archive exercises that left the seed."""
    # Workout history depends on an exercise's type, so the seed may never change it.
    conflicts = await _type_conflicts(session, library)
    if conflicts:
        raise SeedError("exercise type is immutable: " + "; ".join(conflicts))

    muscle_ids = {m.slug: library_id("muscle", m.slug) for m in library.muscles}
    equipment_ids = {e.slug: library_id("equipment", e.slug) for e in library.equipment}

    muscle_rows = [
        {"id": muscle_ids[m.slug], "slug": m.slug, "name": m.name, "body_map_key": m.body_map_key}
        for m in library.muscles
    ]
    new_muscles, changed_muscles = await _upsert(
        session, Muscle, muscle_rows, ["slug", "name", "body_map_key"]
    )

    equipment_rows = [
        {
            "id": equipment_ids[e.slug],
            "slug": e.slug,
            "name": e.name,
            "increment_kg": e.increment_kg,
        }
        for e in library.equipment
    ]
    new_equipment, changed_equipment = await _upsert(
        session, Equipment, equipment_rows, ["slug", "name", "increment_kg"]
    )

    exercise_rows = [
        {
            "id": library_id("exercise", ex.slug),
            "owner_user_id": None,
            "name": ex.name,
            "type": ex.type,
            "equipment_id": equipment_ids[ex.equipment],
            "primary_muscle_id": muscle_ids[ex.primary_muscle],
            "instructions": ex.instructions,
            "media_video_url": ex.media_video_url,
            "media_thumb_url": ex.media_thumb_url,
            "media_license": ex.media_license,
            "is_archived": False,
        }
        for ex in library.exercises
    ]
    new_exercises, changed_exercises = await _upsert(
        session,
        Exercise,
        exercise_rows,
        [
            "owner_user_id",
            "name",
            "equipment_id",
            "primary_muscle_id",
            "instructions",
            "media_video_url",
            "media_thumb_url",
            "media_license",
            "is_archived",
        ],
    )

    secondary_changed = await _sync_secondary_muscles(
        session,
        {
            library_id("exercise", ex.slug): {muscle_ids[s] for s in ex.secondary_muscles}
            for ex in library.exercises
        },
    )
    # A row whose only change is its secondary muscles still changed: bump it so clients
    # (ETag, sync) see it.
    touched = secondary_changed - new_exercises - changed_exercises
    if touched:
        await session.execute(
            update(Exercise)
            .where(Exercise.id.in_(touched))
            .values(updated_at=func.now(), version=Exercise.version + 1)
        )
    changed_exercises |= touched

    seeded = {row["id"] for row in exercise_rows}
    archived = (
        await session.execute(
            update(Exercise)
            .where(
                Exercise.owner_user_id.is_(None),
                Exercise.is_archived.is_(False),
                Exercise.id.not_in(seeded),
            )
            .values(is_archived=True, updated_at=func.now(), version=Exercise.version + 1)
            .returning(Exercise.id)
        )
    ).all()

    await session.commit()

    def counts(
        total: int, new: set[uuid.UUID], changed: set[uuid.UUID], gone: int = 0
    ) -> SeedCounts:
        return SeedCounts(len(new), len(changed), total - len(new) - len(changed), gone)

    return SeedReport(
        muscles=counts(len(muscle_rows), new_muscles, changed_muscles),
        equipment=counts(len(equipment_rows), new_equipment, changed_equipment),
        exercises=counts(len(exercise_rows), new_exercises, changed_exercises, len(archived)),
    )
