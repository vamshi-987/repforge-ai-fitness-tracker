"""Finished workouts: idempotent save under the client's UUID, history and soft delete.

`PUT /workouts/{id}` carries the whole workout. The first PUT creates it; the same PUT again
(a retry after a lost response) finds identical content and changes nothing; a PUT with
different content replaces the workout, but only within 24 hours of its end. After that the
workout is history and only its visibility may change.

Every save recomputes the stored aggregates (volume, sets per muscle) and the personal
records of the exercises it touches, then bumps the user's stats cache generation.
"""

import base64
import binascii
import json
import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import delete, insert, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ConflictError, NotFoundError
from app.db.models import (
    Exercise,
    Muscle,
    PersonalRecord,
    RecordType,
    Routine,
    User,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    workout_muscle_sets,
)
from app.schemas.workouts import (
    RecordOut,
    WorkoutExerciseIn,
    WorkoutExerciseOut,
    WorkoutOut,
    WorkoutPage,
    WorkoutPut,
    WorkoutSetOut,
)
from app.services import stats
from app.services.profile import invalid_at, round_half_up
from app.services.records import RecordEntry, SessionExercise, SetPerf, detect_records
from app.services.routines import SupersetError, normalize_supersets
from app.services.stats import ExerciseWork, SetLoad, workout_totals

# A finished workout can be changed for this long after it ended (CLAUDE.md §3, decision 2).
EDITABLE_FOR = timedelta(hours=24)
# Phones' clocks drift; an end time this far ahead of the server is still accepted.
CLOCK_SKEW = timedelta(minutes=5)
RECORD_ORDER = list(RecordType)


# --- pure helpers -----------------------------------------------------------------------


def _round(value: float | None, places: int) -> float | None:
    return None if value is None else round_half_up(value, places)


def build_exercises(
    items: Sequence[WorkoutExerciseIn], groups: Sequence[int | None]
) -> list[WorkoutExercise]:
    return [
        WorkoutExercise(
            id=uuid.uuid4(),
            exercise_id=item.exercise_id,
            position=index,
            superset_group=groups[index],
            notes=item.notes,
            sets=[
                WorkoutSet(
                    id=uuid.uuid4(),
                    position=set_index,
                    set_type=s.set_type,
                    weight_kg=_round(s.weight_kg, 2),
                    reps=s.reps,
                    duration_s=s.duration_s,
                    distance_m=_round(s.distance_m, 2),
                    rpe=s.rpe,
                    completed=s.completed,
                )
                for set_index, s in enumerate(item.sets)
            ],
        )
        for index, item in enumerate(items)
    ]


def tree_key(exercises: Sequence[WorkoutExercise]) -> list[tuple[Any, ...]]:
    """The workout's exercises and sets without row ids, to tell a change from a resave."""
    return [
        (
            e.exercise_id,
            e.superset_group,
            e.notes,
            [
                (s.set_type, s.weight_kg, s.reps, s.duration_s, s.distance_m, s.rpe, s.completed)
                for s in e.sets
            ],
        )
        for e in exercises
    ]


def is_editable(workout: Workout, now: datetime) -> bool:
    return now <= workout.ended_at + EDITABLE_FOR


def encode_cursor(started_at: datetime, workout_id: uuid.UUID) -> str:
    raw = json.dumps([started_at.isoformat(), str(workout_id)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        started, ident = json.loads(base64.urlsafe_b64decode(padded))
        moment = datetime.fromisoformat(started)
        if moment.tzinfo is None:
            raise ValueError
        return moment, uuid.UUID(ident)
    except (ValueError, TypeError, AttributeError, binascii.Error) as exc:
        raise AppError("invalid_cursor", "Cursor is invalid", 422) from exc


# --- checks -----------------------------------------------------------------------------


def _supersets(items: Sequence[WorkoutExerciseIn]) -> list[int | None]:
    try:
        return normalize_supersets([item.superset_group for item in items])
    except SupersetError as exc:
        raise invalid_at(
            ["body", "exercises", exc.index, "superset_group"],
            "exercises in a superset must be next to each other",
        ) from exc


async def _exercises(
    session: AsyncSession, user: User, items: Sequence[WorkoutExerciseIn]
) -> dict[uuid.UUID, Exercise]:
    """Library exercises and the user's own custom ones. Deleted custom exercises are
    accepted: a workout logged offline must never be refused because of a later delete."""
    rows = await session.scalars(
        select(Exercise)
        .where(Exercise.id.in_({item.exercise_id for item in items}))
        .options(selectinload(Exercise.secondary_muscles))
    )
    usable = {row.id: row for row in rows if row.owner_user_id in (None, user.id)}
    for index, item in enumerate(items):
        if item.exercise_id not in usable:
            raise invalid_at(["body", "exercises", index, "exercise_id"], "unknown exercise")
    return usable


async def _own_routine(
    session: AsyncSession, user: User, routine_id: uuid.UUID | None
) -> uuid.UUID | None:
    """Keep the link only if it points at one of the user's routines (deleted ones too).
    A dangling link is dropped rather than refusing the workout."""
    if routine_id is None:
        return None
    routine = await session.get(Routine, routine_id)
    return routine_id if routine is not None and routine.user_id == user.id else None


# --- loading ----------------------------------------------------------------------------


def _with_tree() -> tuple[Any, ...]:
    exercises = selectinload(Workout.exercises)
    return (
        exercises.selectinload(WorkoutExercise.sets),
        exercises.joinedload(WorkoutExercise.exercise),
    )


async def _find(
    session: AsyncSession, workout_id: uuid.UUID, *, for_update: bool = False
) -> Workout | None:
    query = (
        select(Workout)
        .where(Workout.id == workout_id)
        .options(*_with_tree())
        # Reload the tree: after a write, the session still holds the previous children.
        .execution_options(populate_existing=True)
    )
    if for_update:
        query = query.with_for_update()
    return await session.scalar(query)


def _not_found() -> NotFoundError:
    return NotFoundError("Workout not found")


async def _owned(session: AsyncSession, user: User, workout_id: uuid.UUID) -> Workout:
    workout = await _find(session, workout_id)
    if workout is None or workout.user_id != user.id or workout.deleted_at is not None:
        raise _not_found()
    return workout


async def workouts_out(session: AsyncSession, workouts: Sequence[Workout]) -> list[WorkoutOut]:
    """API objects for loaded workouts; muscle sets and records are read in one query each."""
    ids = [w.id for w in workouts]
    muscle_sets: dict[uuid.UUID, dict[str, float]] = defaultdict(dict)
    records: dict[uuid.UUID, list[PersonalRecord]] = defaultdict(list)
    if ids:
        rows = await session.execute(
            select(workout_muscle_sets.c.workout_id, Muscle.slug, workout_muscle_sets.c.sets)
            .join(Muscle, Muscle.id == workout_muscle_sets.c.muscle_id)
            .where(workout_muscle_sets.c.workout_id.in_(ids))
            .order_by(Muscle.slug)
        )
        for workout_id, slug, sets in rows:
            muscle_sets[workout_id][slug] = float(sets)
        for record in await session.scalars(
            select(PersonalRecord).where(PersonalRecord.workout_id.in_(ids))
        ):
            records[record.workout_id].append(record)

    def out(w: Workout) -> WorkoutOut:
        # Records in workout order: by the exercise's first position, then by record type.
        position = {e.exercise_id: e.position for e in reversed(w.exercises)}
        ordered = sorted(
            records[w.id],
            key=lambda r: (position.get(r.exercise_id, 0), RECORD_ORDER.index(r.record_type)),
        )
        return WorkoutOut(
            id=w.id,
            routine_id=w.routine_id,
            title=w.title,
            notes=w.notes,
            started_at=w.started_at,
            ended_at=w.ended_at,
            duration_s=int((w.ended_at - w.started_at).total_seconds()),
            visibility=w.visibility,
            total_volume_kg=w.total_volume_kg,
            total_sets=w.total_sets,
            exercises=[
                WorkoutExerciseOut(
                    id=e.id,
                    exercise_id=e.exercise_id,
                    exercise_name=e.exercise.name,
                    exercise_type=e.exercise.type,
                    superset_group=e.superset_group,
                    notes=e.notes,
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
                        for s in e.sets
                    ],
                )
                for e in w.exercises
            ],
            muscle_sets=muscle_sets[w.id],
            records=[
                RecordOut(
                    exercise_id=r.exercise_id,
                    record_type=r.record_type,
                    value=r.value,
                    previous_value=r.previous_value,
                    set_id=r.workout_set_id,
                )
                for r in ordered
            ],
            version=w.version,
            created_at=w.created_at,
            updated_at=w.updated_at,
        )

    return [out(w) for w in workouts]


async def get_workout(session: AsyncSession, user: User, workout_id: uuid.UUID) -> WorkoutOut:
    (result,) = await workouts_out(session, [await _owned(session, user, workout_id)])
    return result


async def list_workouts(
    session: AsyncSession, user: User, *, cursor: str | None, limit: int
) -> WorkoutPage:
    """Newest first, by start time."""
    query = (
        select(Workout)
        .where(Workout.user_id == user.id, Workout.deleted_at.is_(None))
        .options(*_with_tree())
        .order_by(Workout.started_at.desc(), Workout.id.desc())
        .limit(limit + 1)
        .execution_options(populate_existing=True)
    )
    if cursor:
        started_at, workout_id = decode_cursor(cursor)
        query = query.where(tuple_(Workout.started_at, Workout.id) < tuple_(started_at, workout_id))
    rows = list(await session.scalars(query))
    page = rows[:limit]
    next_cursor = (
        encode_cursor(page[-1].started_at, page[-1].id) if len(rows) > limit and page else None
    )
    return WorkoutPage(items=await workouts_out(session, page), next_cursor=next_cursor)


# --- aggregates and records -------------------------------------------------------------


async def _store_totals(
    session: AsyncSession, workout: Workout, exercises: dict[uuid.UUID, Exercise]
) -> None:
    totals = workout_totals(
        ExerciseWork(
            exercise_type=exercises[e.exercise_id].type,
            primary_muscle_id=exercises[e.exercise_id].primary_muscle_id,
            secondary_muscle_ids=[m.id for m in exercises[e.exercise_id].secondary_muscles],
            sets=[SetLoad(s.set_type, s.weight_kg, s.reps, s.completed) for s in e.sets],
        )
        for e in workout.exercises
    )
    workout.total_volume_kg = totals.volume_kg
    workout.total_sets = totals.completed_sets
    await session.execute(
        delete(workout_muscle_sets).where(workout_muscle_sets.c.workout_id == workout.id)
    )
    if totals.muscle_sets:
        await session.execute(
            insert(workout_muscle_sets),
            [
                {"workout_id": workout.id, "muscle_id": muscle, "sets": round_half_up(sets, 1)}
                for muscle, sets in totals.muscle_sets.items()
            ],
        )


async def _history(
    session: AsyncSession, user_id: uuid.UUID, exercise_ids: set[uuid.UUID]
) -> list[SessionExercise]:
    """Every session of these exercises, in the order they happened."""
    rows = await session.execute(
        select(
            Workout.id,
            Workout.ended_at,
            WorkoutExercise.id,
            WorkoutExercise.exercise_id,
            Exercise.type,
            WorkoutSet.id,
            WorkoutSet.set_type,
            WorkoutSet.weight_kg,
            WorkoutSet.reps,
            WorkoutSet.completed,
        )
        .join(WorkoutExercise, WorkoutExercise.workout_id == Workout.id)
        .join(Exercise, Exercise.id == WorkoutExercise.exercise_id)
        .join(WorkoutSet, WorkoutSet.workout_exercise_id == WorkoutExercise.id)
        .where(
            Workout.user_id == user_id,
            Workout.deleted_at.is_(None),
            WorkoutExercise.exercise_id.in_(exercise_ids),
        )
        .order_by(Workout.started_at, Workout.id, WorkoutExercise.position, WorkoutSet.position)
    )
    # One entry per exercise row of a workout; its sets follow in order.
    entries: dict[uuid.UUID, tuple[tuple[Any, ...], list[SetPerf]]] = {}
    for row in rows:
        workout_id, ended_at, entry_id, exercise_id, kind, *set_fields = row
        _, sets = entries.setdefault(entry_id, ((workout_id, exercise_id, kind, ended_at), []))
        sets.append(SetPerf(*set_fields))
    return [
        SessionExercise(workout_id, exercise_id, kind, ended_at, sets)
        for (workout_id, exercise_id, kind, ended_at), sets in entries.values()
    ]


def _record_key(r: RecordEntry | PersonalRecord) -> tuple[Any, ...]:
    if isinstance(r, PersonalRecord):
        return (
            r.workout_id,
            r.exercise_id,
            r.record_type,
            r.value,
            r.previous_value,
            r.workout_set_id,
        )
    return (r.workout_id, r.exercise_id, r.record_type, r.value, r.previous, r.set_id)


async def refresh_records(
    session: AsyncSession, user_id: uuid.UUID, exercise_ids: set[uuid.UUID]
) -> set[uuid.UUID]:
    """Recompute the records of these exercises from the whole history. Returns the ids of
    workouts whose records changed."""
    computed = detect_records(await _history(session, user_id, exercise_ids))
    stored = list(
        await session.scalars(
            select(PersonalRecord).where(
                PersonalRecord.user_id == user_id, PersonalRecord.exercise_id.in_(exercise_ids)
            )
        )
    )
    new_keys = {_record_key(r) for r in computed}
    old_keys = {_record_key(r) for r in stored}
    if new_keys == old_keys:
        return set()
    changed = {key[0] for key in new_keys ^ old_keys}
    await session.execute(
        delete(PersonalRecord).where(
            PersonalRecord.user_id == user_id, PersonalRecord.exercise_id.in_(exercise_ids)
        )
    )
    session.add_all(
        PersonalRecord(
            user_id=user_id,
            exercise_id=r.exercise_id,
            record_type=r.record_type,
            value=r.value,
            previous_value=r.previous,
            workout_id=r.workout_id,
            workout_set_id=r.set_id,
            achieved_at=r.achieved_at,
        )
        for r in computed
    )
    return changed


async def _refresh_records_and_bump(
    session: AsyncSession, user_id: uuid.UUID, exercise_ids: set[uuid.UUID], saved: uuid.UUID
) -> None:
    await session.flush()
    changed = await refresh_records(session, user_id, exercise_ids) - {saved}
    if changed:
        # Their records are part of what other devices pull, so they count as changed.
        await session.execute(
            update(Workout)
            .where(Workout.id.in_(changed), Workout.deleted_at.is_(None))
            .values(version=Workout.version + 1)
        )


# --- writes -----------------------------------------------------------------------------


async def put_workout(
    session: AsyncSession,
    redis: Redis,
    user: User,
    workout_id: uuid.UUID,
    body: WorkoutPut,
    now: datetime,
) -> tuple[WorkoutOut, bool]:
    """Create or replace the workout. Returns it and whether it was created."""
    try:
        created = await _put(session, user, workout_id, body, now)
    except IntegrityError:
        # Two first saves of the same workout raced; the loser re-runs as an update, which
        # finds identical content and changes nothing.
        await session.rollback()
        # The rollback expired every loaded object; reload the user without lazy IO.
        await session.refresh(user)
        created = await _put(session, user, workout_id, body, now)
    await stats.bump_generation(redis, user.id)
    return await get_workout(session, user, workout_id), created


async def _put(
    session: AsyncSession, user: User, workout_id: uuid.UUID, body: WorkoutPut, now: datetime
) -> bool:
    if body.ended_at > now + CLOCK_SKEW:
        raise invalid_at(["body", "ended_at"], "ended_at is in the future")
    groups = _supersets(body.exercises)
    # Before loading the exercises: `_find` repopulates exercise rows it joins, which would
    # drop the secondary muscles `_exercises` loads.
    existing = await _find(session, workout_id, for_update=True)
    exercises = await _exercises(session, user, body.exercises)
    routine_id = await _own_routine(session, user, body.routine_id)
    replacement = build_exercises(body.exercises, groups)

    if existing is None:
        workout = Workout(
            id=workout_id,
            user_id=user.id,
            routine_id=routine_id,
            title=body.title,
            notes=body.notes,
            started_at=body.started_at,
            ended_at=body.ended_at,
            visibility=body.visibility,
            exercises=replacement,
            total_volume_kg=0,
            total_sets=0,
        )
        session.add(workout)
        await session.flush()
        await _store_totals(session, workout, exercises)
        await _refresh_records_and_bump(session, user.id, set(exercises), workout.id)
        await session.commit()
        return True

    if existing.user_id != user.id:
        raise ConflictError("workout_exists", "A workout with this id already exists")
    if existing.deleted_at is not None:
        raise ConflictError("workout_deleted", "This workout was deleted")

    content_changed = (
        (existing.title, existing.notes, existing.routine_id)
        != (body.title, body.notes, routine_id)
        or (existing.started_at, existing.ended_at) != (body.started_at, body.ended_at)
        or tree_key(existing.exercises) != tree_key(replacement)
    )
    visibility_changed = existing.visibility != body.visibility
    if not content_changed and not visibility_changed:
        return False
    # Visibility is a privacy control, so it stays changeable; the content is history.
    if content_changed and not is_editable(existing, now):
        raise ConflictError(
            "workout_immutable",
            "Workouts can only be changed within 24 hours of finishing",
            {"version": existing.version},
        )

    existing.visibility = body.visibility
    existing.version += 1
    if content_changed:
        touched = {e.exercise_id for e in existing.exercises} | set(exercises)
        existing.title = body.title
        existing.notes = body.notes
        existing.routine_id = routine_id
        existing.started_at = body.started_at
        existing.ended_at = body.ended_at
        existing.exercises.clear()
        # Delete the old rows first: the new ones reuse their (workout, position) slots.
        await session.flush()
        existing.exercises.extend(replacement)
        await session.flush()
        await _store_totals(session, existing, exercises)
        await _refresh_records_and_bump(session, user.id, touched, existing.id)
    await session.commit()
    return False


async def delete_workout(
    session: AsyncSession, redis: Redis, user: User, workout_id: uuid.UUID, now: datetime
) -> None:
    """Soft delete, so other devices can pull the removal. Later workouts may become records
    again, so the records of its exercises are recomputed."""
    workout = await _owned(session, user, workout_id)
    workout.deleted_at = now
    workout.version += 1
    await _refresh_records_and_bump(
        session, user.id, {e.exercise_id for e in workout.exercises}, workout.id
    )
    await session.commit()
    await stats.bump_generation(redis, user.id)
