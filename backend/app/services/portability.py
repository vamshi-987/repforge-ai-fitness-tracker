"""A user's data, out and back in: everything as JSON, workouts as CSV (CLAUDE.md §13)."""

import csv
import io
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.db.models import (
    BodyMeasurement,
    BodyWeight,
    Exercise,
    Follow,
    Food,
    FoodLog,
    NutritionTarget,
    PersonalRecord,
    ProgressPhoto,
    SetType,
    User,
    WaterLog,
    WeeklyReport,
    Workout,
    WorkoutComment,
    WorkoutExercise,
    WorkoutLike,
)
from app.schemas.portability import ImportReport
from app.schemas.workouts import WorkoutExerciseIn, WorkoutPut, WorkoutSetIn
from app.services.body import photo_out
from app.services.nutrition import list_saved_meals
from app.services.profile import field_error, get_me
from app.services.routines import list_folders, list_routines
from app.services.workouts import put_workout, with_tree, workouts_out

CSV_COLUMNS = (
    "title",
    "started_at",
    "ended_at",
    "notes",
    "exercise",
    "set_type",
    "weight_kg",
    "reps",
    "duration_s",
    "distance_m",
    "rpe",
)
# Stable ids, so importing the same file twice from two phones can't race into duplicates.
IMPORT_NAMESPACE = uuid.UUID("6f7d1c2e-6a0f-4f55-9b1c-0a5f5b1d7e21")
MAX_IMPORT_BYTES = 5 * 1024 * 1024
# A spreadsheet would run a cell starting with one of these as a formula.
FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


# --- export -------------------------------------------------------------------------------


def _plain(row: Any) -> dict[str, Any]:
    """A row's columns, minus the sync bookkeeping nobody needs in their own export."""
    columns = inspect(type(row)).columns
    return {
        c.key: getattr(row, c.key) for c in columns if c.key not in ("change_seq", "deleted_at")
    }


async def _rows(session: AsyncSession, model: Any, *conditions: Any) -> list[dict[str, Any]]:
    if hasattr(model, "deleted_at"):
        conditions = (*conditions, model.deleted_at.is_(None))
    return [_plain(row) for row in await session.scalars(select(model).where(*conditions))]


async def _workouts(session: AsyncSession, user: User) -> Sequence[Workout]:
    rows = await session.scalars(
        select(Workout)
        .where(Workout.user_id == user.id, Workout.deleted_at.is_(None))
        .options(*with_tree())
        .order_by(Workout.started_at)
    )
    return list(rows)


async def export_all(
    session: AsyncSession, settings: Settings, user: User, now: datetime
) -> dict[str, Any]:
    """Everything stored about the user, except secrets. Photos come as links good for an hour."""
    workouts = await workouts_out(session, await _workouts(session, user))
    photos = await session.scalars(
        select(ProgressPhoto).where(
            ProgressPhoto.user_id == user.id, ProgressPhoto.deleted_at.is_(None)
        )
    )
    return {
        "exported_at": now,
        "account": (await get_me(session, user)).model_dump(mode="json"),
        "workouts": [w.model_dump(mode="json") for w in workouts],
        "personal_records": await _rows(session, PersonalRecord, PersonalRecord.user_id == user.id),
        "routines": (await list_routines(session, user, None)).model_dump(mode="json"),
        "routine_folders": [f.model_dump(mode="json") for f in await list_folders(session, user)],
        "custom_exercises": await _rows(session, Exercise, Exercise.owner_user_id == user.id),
        "body_weights": await _rows(session, BodyWeight, BodyWeight.user_id == user.id),
        "body_measurements": await _rows(
            session, BodyMeasurement, BodyMeasurement.user_id == user.id
        ),
        "progress_photos": [photo_out(settings, p, now).model_dump(mode="json") for p in photos],
        "water_logs": await _rows(session, WaterLog, WaterLog.user_id == user.id),
        "custom_foods": await _rows(session, Food, Food.owner_user_id == user.id),
        "food_logs": await _rows(session, FoodLog, FoodLog.user_id == user.id),
        "saved_meals": [m.model_dump(mode="json") for m in await list_saved_meals(session, user)],
        "nutrition_targets": await _rows(
            session, NutritionTarget, NutritionTarget.user_id == user.id
        ),
        "weekly_reports": await _rows(session, WeeklyReport, WeeklyReport.user_id == user.id),
        "follows": await _rows(
            session, Follow, or_(Follow.follower_id == user.id, Follow.followee_id == user.id)
        ),
        "workout_likes": await _rows(session, WorkoutLike, WorkoutLike.user_id == user.id),
        "workout_comments": await _rows(session, WorkoutComment, WorkoutComment.user_id == user.id),
    }


def safe_cell(text: str) -> str:
    return f"'{text}" if text.startswith(FORMULA_STARTS) else text


def _unsafe_cell(text: str) -> str:
    return text[1:] if text.startswith("'") and text[1:].startswith(FORMULA_STARTS) else text


def _csv_rows(workouts: Iterable[Workout]) -> Iterable[list[Any]]:
    for workout in workouts:
        for item in workout.exercises:
            for one in item.sets:
                yield [
                    safe_cell(workout.title),
                    workout.started_at.isoformat(),
                    workout.ended_at.isoformat(),
                    safe_cell(workout.notes),
                    safe_cell(item.exercise.name),
                    one.set_type.value,
                    one.weight_kg,
                    one.reps,
                    one.duration_s,
                    one.distance_m,
                    one.rpe,
                ]


async def export_workouts_csv(session: AsyncSession, user: User) -> str:
    rows = await session.scalars(
        select(Workout)
        .where(Workout.user_id == user.id, Workout.deleted_at.is_(None))
        .options(
            selectinload(Workout.exercises).selectinload(WorkoutExercise.exercise),
            selectinload(Workout.exercises).selectinload(WorkoutExercise.sets),
        )
        .order_by(Workout.started_at)
    )
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    writer.writerows(_csv_rows(rows))
    return out.getvalue()


# --- import -------------------------------------------------------------------------------


@dataclass
class _ParsedExercise:
    name: str
    sets: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ParsedWorkout:
    title: str
    started_at: str
    ended_at: str
    notes: str
    exercises: list[_ParsedExercise] = field(default_factory=list)


def _number(text: str | None) -> str | None:
    return text.strip() or None if text else None


def parse_workouts_csv(data: bytes) -> list[ParsedWorkout]:
    """Rows to workouts, in file order. Rows of one workout share its title and start time, and
    consecutive rows of one exercise are its sets."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise field_error("file", "the file isn't UTF-8 text") from exc
    reader = csv.DictReader(io.StringIO(text))
    missing = set(CSV_COLUMNS) - set(reader.fieldnames or ())
    if missing:
        raise field_error("file", f"missing columns: {', '.join(sorted(missing))}")
    workouts: dict[tuple[str, str], ParsedWorkout] = {}
    for row in reader:
        title = _unsafe_cell(row["title"].strip())
        started_at = row["started_at"].strip()
        workout = workouts.setdefault(
            (title, started_at),
            ParsedWorkout(
                title=title,
                started_at=started_at,
                ended_at=row["ended_at"].strip(),
                notes=_unsafe_cell(row["notes"]),
            ),
        )
        name = _unsafe_cell(row["exercise"].strip())
        if not workout.exercises or workout.exercises[-1].name != name:
            workout.exercises.append(_ParsedExercise(name))
        workout.exercises[-1].sets.append(
            {
                "set_type": row["set_type"].strip() or SetType.NORMAL.value,
                "weight_kg": _number(row["weight_kg"]),
                "reps": _number(row["reps"]),
                "duration_s": _number(row["duration_s"]),
                "distance_m": _number(row["distance_m"]),
                "rpe": _number(row["rpe"]),
            }
        )
    return list(workouts.values())


async def _exercise_ids(session: AsyncSession, user: User) -> dict[str, uuid.UUID]:
    """Lower-cased name → id; the user's own exercises win over the library's."""
    rows = await session.execute(
        select(Exercise.name, Exercise.id)
        .where(
            or_(Exercise.owner_user_id.is_(None), Exercise.owner_user_id == user.id),
            Exercise.deleted_at.is_(None),
        )
        .order_by(Exercise.owner_user_id.is_(None).desc())
    )
    return {name.lower(): exercise_id for name, exercise_id in rows}


def _to_put(parsed: ParsedWorkout, ids: dict[str, uuid.UUID]) -> WorkoutPut:
    return WorkoutPut(
        title=parsed.title,
        notes=parsed.notes,
        started_at=datetime.fromisoformat(parsed.started_at),
        ended_at=datetime.fromisoformat(parsed.ended_at),
        exercises=[
            WorkoutExerciseIn(
                exercise_id=ids[e.name.lower()],
                sets=[WorkoutSetIn.model_validate(s) for s in e.sets],
            )
            for e in parsed.exercises
        ],
    )


async def _exists(session: AsyncSession, user: User, body: WorkoutPut) -> bool:
    count = await session.scalar(
        select(func.count())
        .select_from(Workout)
        .where(
            Workout.user_id == user.id,
            Workout.deleted_at.is_(None),
            Workout.title == body.title,
            Workout.started_at == body.started_at,
        )
    )
    return bool(count)


async def import_workouts_csv(
    session: AsyncSession, redis: Redis, user: User, data: bytes, now: datetime
) -> ImportReport:
    """Add the file's workouts, as private ones. Importing a file twice adds nothing."""
    if len(data) > MAX_IMPORT_BYTES:
        raise field_error("file", "the file is larger than 5 MB")
    parsed = parse_workouts_csv(data)
    ids = await _exercise_ids(session, user)
    report = ImportReport(imported=0, duplicates=0, unknown_exercises=[], invalid=[])
    for workout in parsed:
        unknown = sorted({e.name for e in workout.exercises if e.name.lower() not in ids})
        if unknown:
            report.unknown_exercises.extend(n for n in unknown if n not in report.unknown_exercises)
            continue
        try:
            body = _to_put(workout, ids)
        except (ValidationError, ValueError):
            report.invalid.append(workout.title)
            continue
        if await _exists(session, user, body):
            report.duplicates += 1
            continue
        workout_id = uuid.uuid5(
            IMPORT_NAMESPACE, f"{user.id}:{body.title}:{body.started_at.isoformat()}"
        )
        await put_workout(session, redis, user, workout_id, body, now)
        report.imported += 1
    return report
