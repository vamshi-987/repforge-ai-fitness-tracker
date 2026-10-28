"""Routines (workout templates) and the folders that group them.

A routine is one aggregate: its exercises and sets are always written together, `version`
goes up once per change, and Phase 4 syncs it as one row. Positions order routines within a
folder (or among routines without one) and folders among themselves; gaps are harmless.
"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.db.change_lock import lock_changes
from app.db.models import Exercise, Routine, RoutineExercise, RoutineFolder, RoutineSet, User
from app.schemas.routines import (
    FolderCreate,
    FolderOut,
    FolderReorder,
    FolderUpdate,
    RoutineCreate,
    RoutineDuplicate,
    RoutineExerciseIn,
    RoutineExerciseOut,
    RoutineList,
    RoutineOut,
    RoutineReorder,
    RoutineSetOut,
    RoutineUpdate,
)
from app.schemas.sync import FolderSync, RoutineSync
from app.services.exercises import copy_name
from app.services.profile import field_error, invalid_at, round_half_up

# --- pure helpers -----------------------------------------------------------------------


class _Keep:
    """Marks a field to leave unchanged where None is a real value (no folder)."""


KEEP = _Keep()


class SupersetError(ValueError):
    def __init__(self, index: int) -> None:
        super().__init__(f"superset member at {index} is not next to its group")
        self.index = index


def normalize_supersets(groups: Sequence[int | None]) -> list[int | None]:
    """Renumber superset groups 1, 2, ... in order of appearance; drop one-exercise groups.

    Members of a group must be adjacent. A group number that comes back after a different
    exercise raises `SupersetError` with the index where it reappears.
    """
    runs: list[tuple[int | None, int, int]] = []  # (group, start, end)
    for index, group in enumerate(groups):
        if runs and group is not None and runs[-1][0] == group:
            runs[-1] = (group, runs[-1][1], index + 1)
        else:
            runs.append((group, index, index + 1))

    result: list[int | None] = [None] * len(groups)
    seen: set[int] = set()
    next_group = 1
    for group, start, end in runs:
        if group is None:
            continue
        if group in seen:
            raise SupersetError(start)
        seen.add(group)
        if end - start >= 2:
            result[start:end] = [next_group] * (end - start)
            next_group += 1
    return result


def routine_limit(user: User, settings: Settings) -> int | None:
    """How many routines the user may keep; None = unlimited (Pro)."""
    return None if user.is_pro else settings.free_routine_limit


def _round_weight(kg: float | None) -> float | None:
    return None if kg is None else round_half_up(kg, 2)


def build_exercises(
    items: Sequence[RoutineExerciseIn], groups: Sequence[int | None]
) -> list[RoutineExercise]:
    return [
        RoutineExercise(
            id=uuid.uuid4(),
            exercise_id=item.exercise_id,
            position=index,
            superset_group=groups[index],
            rest_seconds=item.rest_seconds,
            rep_range_min=item.rep_range_min,
            rep_range_max=item.rep_range_max,
            notes=item.notes,
            sets=[
                RoutineSet(
                    id=uuid.uuid4(),
                    position=set_index,
                    set_type=s.set_type,
                    target_weight_kg=_round_weight(s.target_weight_kg),
                    target_reps=s.target_reps,
                    target_duration_s=s.target_duration_s,
                )
                for set_index, s in enumerate(item.sets)
            ],
        )
        for index, item in enumerate(items)
    ]


def copy_exercises(source: Sequence[RoutineExercise]) -> list[RoutineExercise]:
    return [
        RoutineExercise(
            id=uuid.uuid4(),
            exercise_id=e.exercise_id,
            position=e.position,
            superset_group=e.superset_group,
            rest_seconds=e.rest_seconds,
            rep_range_min=e.rep_range_min,
            rep_range_max=e.rep_range_max,
            notes=e.notes,
            sets=[
                RoutineSet(
                    id=uuid.uuid4(),
                    position=s.position,
                    set_type=s.set_type,
                    target_weight_kg=s.target_weight_kg,
                    target_reps=s.target_reps,
                    target_duration_s=s.target_duration_s,
                )
                for s in e.sets
            ],
        )
        for e in source
    ]


def tree_key(exercises: Sequence[RoutineExercise]) -> list[tuple[Any, ...]]:
    """The routine's content without row ids, to tell a real change from a resave."""
    return [
        (
            e.exercise_id,
            e.superset_group,
            e.rest_seconds,
            e.rep_range_min,
            e.rep_range_max,
            e.notes,
            [(s.set_type, s.target_weight_kg, s.target_reps, s.target_duration_s) for s in e.sets],
        )
        for e in exercises
    ]


def routine_out(routine: Routine) -> RoutineOut:
    return RoutineOut(
        id=routine.id,
        folder_id=routine.folder_id,
        name=routine.name,
        notes=routine.notes,
        position=routine.position,
        exercises=[
            RoutineExerciseOut(
                exercise_id=e.exercise_id,
                exercise_name=e.exercise.name,
                exercise_type=e.exercise.type,
                superset_group=e.superset_group,
                rest_seconds=e.rest_seconds,
                rep_range_min=e.rep_range_min,
                rep_range_max=e.rep_range_max,
                notes=e.notes,
                sets=[
                    RoutineSetOut(
                        set_type=s.set_type,
                        target_weight_kg=s.target_weight_kg,
                        target_reps=s.target_reps,
                        target_duration_s=s.target_duration_s,
                    )
                    for s in e.sets
                ],
            )
            for e in routine.exercises
        ],
        version=routine.version,
        created_at=routine.created_at,
        updated_at=routine.updated_at,
    )


# --- checks -----------------------------------------------------------------------------


def _supersets(items: Sequence[RoutineExerciseIn]) -> list[int | None]:
    try:
        return normalize_supersets([item.superset_group for item in items])
    except SupersetError as exc:
        raise invalid_at(
            ["body", "exercises", exc.index, "superset_group"],
            "exercises in a superset must be next to each other",
        ) from exc


async def _check_exercises(
    session: AsyncSession,
    user: User,
    items: Sequence[RoutineExerciseIn],
    already_used: set[uuid.UUID],
) -> None:
    """Library exercises (archived too) and the user's own custom ones. A deleted custom
    exercise is accepted only if the routine already had it, so the routine stays editable."""
    ids = {item.exercise_id for item in items}
    if not ids:
        return
    rows = await session.execute(
        select(Exercise.id, Exercise.owner_user_id, Exercise.deleted_at).where(Exercise.id.in_(ids))
    )
    usable = {
        row.id
        for row in rows
        if row.owner_user_id in (None, user.id)
        and (row.deleted_at is None or row.id in already_used)
    }
    for index, item in enumerate(items):
        if item.exercise_id not in usable:
            raise invalid_at(["body", "exercises", index, "exercise_id"], "unknown exercise")


async def _check_folder(session: AsyncSession, user: User, folder_id: uuid.UUID | None) -> None:
    if folder_id is None:
        return
    folder = await session.get(RoutineFolder, folder_id)
    if folder is None or folder.user_id != user.id or folder.deleted_at is not None:
        raise field_error("folder_id", "unknown folder")


async def _enforce_limit(session: AsyncSession, user: User, limit: int | None) -> None:
    if limit is None:
        return
    # Lock the user's row so two concurrent creates can't both pass the count.
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    count = await session.scalar(
        select(func.count(Routine.id)).where(
            Routine.user_id == user.id, Routine.deleted_at.is_(None)
        )
    )
    if (count or 0) >= limit:
        raise AppError(
            "routine_limit_reached",
            f"Free accounts can keep {limit} routines. Upgrade to Pro for unlimited routines.",
            403,
            {"limit": limit},
        )


def _in_folder(folder_id: uuid.UUID | None) -> ColumnElement[bool]:
    return Routine.folder_id.is_(None) if folder_id is None else Routine.folder_id == folder_id


async def _next_routine_position(
    session: AsyncSession, user_id: uuid.UUID, folder_id: uuid.UUID | None
) -> int:
    current = await session.scalar(
        select(func.max(Routine.position)).where(
            Routine.user_id == user_id, Routine.deleted_at.is_(None), _in_folder(folder_id)
        )
    )
    return 0 if current is None else current + 1


async def _next_folder_position(session: AsyncSession, user_id: uuid.UUID) -> int:
    current = await session.scalar(
        select(func.max(RoutineFolder.position)).where(
            RoutineFolder.user_id == user_id, RoutineFolder.deleted_at.is_(None)
        )
    )
    return 0 if current is None else current + 1


async def _commit_new(session: AsyncSession, code: str, message: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        # Two creates with the same client id raced past the existence check.
        await session.rollback()
        raise ConflictError(code, message) from exc


# --- routines ---------------------------------------------------------------------------


def _routine_not_found() -> NotFoundError:
    return NotFoundError("Routine not found")


def with_tree() -> tuple[Any, ...]:
    exercises = selectinload(Routine.exercises)
    return (
        exercises.selectinload(RoutineExercise.sets),
        exercises.joinedload(RoutineExercise.exercise),
    )


def _active_routines(user_id: uuid.UUID) -> tuple[ColumnElement[bool], ...]:
    return (Routine.user_id == user_id, Routine.deleted_at.is_(None))


async def _load(
    session: AsyncSession, user: User, routine_id: uuid.UUID, *, for_update: bool = False
) -> Routine:
    query = (
        select(Routine)
        .where(Routine.id == routine_id)
        .options(*with_tree())
        # Reload the tree: after a write, the session still holds the previous children.
        .execution_options(populate_existing=True)
    )
    if for_update:
        query = query.with_for_update()
    routine = await session.scalar(query)
    if routine is None or routine.user_id != user.id or routine.deleted_at is not None:
        raise _routine_not_found()
    return routine


async def list_routines(session: AsyncSession, user: User, limit: int | None) -> RoutineList:
    rows = await session.scalars(
        select(Routine)
        .where(*_active_routines(user.id))
        .options(*with_tree())
        .order_by(Routine.position, Routine.created_at, Routine.id)
        .execution_options(populate_existing=True)
    )
    return RoutineList(items=[routine_out(row) for row in rows], routine_limit=limit)


async def get_routine(session: AsyncSession, user: User, routine_id: uuid.UUID) -> RoutineOut:
    return routine_out(await _load(session, user, routine_id))


async def _ensure_routine_id_free(session: AsyncSession, routine_id: uuid.UUID | None) -> None:
    if routine_id is not None and await session.get(Routine, routine_id) is not None:
        raise ConflictError("routine_exists", "A routine with this id already exists")


async def create_routine(
    session: AsyncSession, user: User, body: RoutineCreate, limit: int | None
) -> RoutineOut:
    # Before any row lock (the limit check locks the user row); see app/db/change_lock.py.
    await lock_changes(session, user.id)
    groups = _supersets(body.exercises)
    await _check_folder(session, user, body.folder_id)
    await _check_exercises(session, user, body.exercises, set())
    await _ensure_routine_id_free(session, body.id)
    await _enforce_limit(session, user, limit)
    routine = Routine(
        id=body.id or uuid.uuid4(),
        user_id=user.id,
        folder_id=body.folder_id,
        name=body.name,
        notes=body.notes,
        position=await _next_routine_position(session, user.id, body.folder_id),
        exercises=build_exercises(body.exercises, groups),
    )
    session.add(routine)
    await _commit_new(session, "routine_exists", "A routine with this id already exists")
    return await get_routine(session, user, routine.id)


async def _change_routine(
    session: AsyncSession,
    user: User,
    routine: Routine,
    *,
    name: str | None,
    notes: str | None,
    folder_id: uuid.UUID | _Keep | None,
    exercises: Sequence[RoutineExerciseIn] | None,
    position: int | None,
) -> bool:
    """Apply the given fields (None or KEEP = unchanged). Without an explicit position, a
    routine moved to another folder goes last in it. Returns whether anything changed."""
    changed = False
    if name is not None and name != routine.name:
        routine.name = name
        changed = True
    if notes is not None and notes != routine.notes:
        routine.notes = notes
        changed = True
    if not isinstance(folder_id, _Keep) and folder_id != routine.folder_id:
        await _check_folder(session, user, folder_id)
        if position is None:
            # Before assigning: autoflush would otherwise count this routine in its new folder.
            position = await _next_routine_position(session, user.id, folder_id)
        routine.folder_id = folder_id
        changed = True
    if position is not None and position != routine.position:
        routine.position = position
        changed = True
    if exercises is not None:
        groups = _supersets(exercises)
        await _check_exercises(session, user, exercises, {e.exercise_id for e in routine.exercises})
        replacement = build_exercises(exercises, groups)
        if tree_key(replacement) != tree_key(routine.exercises):
            routine.exercises.clear()
            # Delete the old rows first: the new ones reuse their (routine, position) slots.
            await session.flush()
            routine.exercises.extend(replacement)
            changed = True
    return changed


async def update_routine(
    session: AsyncSession, user: User, routine_id: uuid.UUID, patch: RoutineUpdate
) -> RoutineOut:
    await lock_changes(session, user.id)
    # Locked, so two edits replacing the exercise list can't interleave.
    routine = await _load(session, user, routine_id, for_update=True)
    changed = await _change_routine(
        session,
        user,
        routine,
        name=patch.name,
        notes=patch.notes,
        folder_id=patch.folder_id if "folder_id" in patch.model_fields_set else KEEP,
        exercises=patch.exercises,
        position=None,
    )
    if not changed:
        return routine_out(routine)
    routine.version += 1
    await session.commit()
    return await get_routine(session, user, routine.id)


async def delete_routine(
    session: AsyncSession, user: User, routine_id: uuid.UUID, now: datetime
) -> None:
    routine = await session.get(Routine, routine_id)
    if routine is None or routine.user_id != user.id or routine.deleted_at is not None:
        raise _routine_not_found()
    # Soft delete, so other devices can pull the removal.
    routine.deleted_at = now
    routine.version += 1
    await session.commit()


async def duplicate_routine(
    session: AsyncSession,
    user: User,
    routine_id: uuid.UUID,
    body: RoutineDuplicate,
    limit: int | None,
) -> RoutineOut:
    await lock_changes(session, user.id)
    source = await _load(session, user, routine_id)
    await _ensure_routine_id_free(session, body.id)
    await _enforce_limit(session, user, limit)
    copy = Routine(
        id=body.id or uuid.uuid4(),
        user_id=user.id,
        folder_id=source.folder_id,
        name=body.name or copy_name(source.name),
        notes=source.notes,
        position=await _next_routine_position(session, user.id, source.folder_id),
        exercises=copy_exercises(source.exercises),
    )
    session.add(copy)
    await _commit_new(session, "routine_exists", "A routine with this id already exists")
    return await get_routine(session, user, copy.id)


async def reorder_routines(
    session: AsyncSession, user: User, body: RoutineReorder, limit: int | None
) -> RoutineList:
    """Move the listed routines into `folder_id` in that order. Routines already in that
    folder but not listed keep their relative order after the listed ones."""
    await lock_changes(session, user.id)
    await _check_folder(session, user, body.folder_id)
    rows = list(
        await session.scalars(select(Routine).where(*_active_routines(user.id)).with_for_update())
    )
    by_id = {row.id: row for row in rows}
    for index, routine_id in enumerate(body.routine_ids):
        if routine_id not in by_id:
            raise invalid_at(["body", "routine_ids", index], "unknown routine")

    listed = set(body.routine_ids)
    rest = sorted(
        (r for r in rows if r.folder_id == body.folder_id and r.id not in listed),
        key=lambda r: (r.position, r.created_at, str(r.id)),
    )
    changed = False
    for position, routine in enumerate([by_id[i] for i in body.routine_ids] + rest):
        if (routine.folder_id, routine.position) != (body.folder_id, position):
            routine.folder_id = body.folder_id
            routine.position = position
            routine.version += 1
            changed = True
    if changed:
        await session.commit()
    return await list_routines(session, user, limit)


# --- folders ----------------------------------------------------------------------------


def _folder_not_found() -> NotFoundError:
    return NotFoundError("Folder not found")


async def _load_folder(session: AsyncSession, user: User, folder_id: uuid.UUID) -> RoutineFolder:
    folder = await session.get(RoutineFolder, folder_id)
    if folder is None or folder.user_id != user.id or folder.deleted_at is not None:
        raise _folder_not_found()
    return folder


async def _active_folders(session: AsyncSession, user: User) -> list[RoutineFolder]:
    return list(
        await session.scalars(
            select(RoutineFolder)
            .where(RoutineFolder.user_id == user.id, RoutineFolder.deleted_at.is_(None))
            .order_by(RoutineFolder.position, RoutineFolder.created_at, RoutineFolder.id)
        )
    )


async def list_folders(session: AsyncSession, user: User) -> list[FolderOut]:
    return [FolderOut.model_validate(f) for f in await _active_folders(session, user)]


async def create_folder(session: AsyncSession, user: User, body: FolderCreate) -> FolderOut:
    if body.id is not None and await session.get(RoutineFolder, body.id) is not None:
        raise ConflictError("folder_exists", "A folder with this id already exists")
    folder = RoutineFolder(
        id=body.id or uuid.uuid4(),
        user_id=user.id,
        name=body.name,
        position=await _next_folder_position(session, user.id),
    )
    session.add(folder)
    await _commit_new(session, "folder_exists", "A folder with this id already exists")
    return FolderOut.model_validate(folder)


async def update_folder(
    session: AsyncSession, user: User, folder_id: uuid.UUID, patch: FolderUpdate
) -> FolderOut:
    folder = await _load_folder(session, user, folder_id)
    if patch.name is not None and patch.name != folder.name:
        folder.name = patch.name
        folder.version += 1
        await session.commit()
    return FolderOut.model_validate(folder)


async def delete_folder(
    session: AsyncSession, user: User, folder_id: uuid.UUID, now: datetime
) -> None:
    """Soft-delete the folder. Its routines are kept and move to the end of the list of
    routines without a folder."""
    folder = await _load_folder(session, user, folder_id)
    start = await _next_routine_position(session, user.id, None)
    members = await session.scalars(
        select(Routine)
        .where(*_active_routines(user.id), Routine.folder_id == folder.id)
        .order_by(Routine.position, Routine.created_at, Routine.id)
    )
    for offset, routine in enumerate(members):
        routine.folder_id = None
        routine.position = start + offset
        routine.version += 1
    folder.deleted_at = now
    folder.version += 1
    await session.commit()


async def reorder_folders(
    session: AsyncSession, user: User, body: FolderReorder
) -> list[FolderOut]:
    """Listed folders first, in that order; unlisted folders keep their order after them."""
    folders = await _active_folders(session, user)
    by_id = {f.id: f for f in folders}
    for index, folder_id in enumerate(body.folder_ids):
        if folder_id not in by_id:
            raise invalid_at(["body", "folder_ids", index], "unknown folder")
    listed = set(body.folder_ids)
    ordered = [by_id[i] for i in body.folder_ids] + [f for f in folders if f.id not in listed]
    changed = False
    for position, folder in enumerate(ordered):
        if folder.position != position:
            folder.position = position
            folder.version += 1
            changed = True
    if changed:
        await session.commit()
    return [FolderOut.model_validate(f) for f in ordered]


# --- sync (POST /sync/push) -------------------------------------------------------------
# The app sends a routine's or folder's full state, with its position. The caller has
# already checked that an existing row is the user's own and not deleted.


async def sync_folder(
    session: AsyncSession, user: User, folder_id: uuid.UUID, body: FolderSync
) -> FolderOut:
    folder = await session.get(RoutineFolder, folder_id)
    if folder is None:
        folder = RoutineFolder(
            id=folder_id, user_id=user.id, name=body.name, position=body.position
        )
        session.add(folder)
        await _commit_new(session, "folder_exists", "A folder with this id already exists")
    elif (folder.name, folder.position) != (body.name, body.position):
        folder.name = body.name
        folder.position = body.position
        folder.version += 1
        await session.commit()
    return FolderOut.model_validate(folder)


async def _usable_folder(
    session: AsyncSession, user: User, folder_id: uuid.UUID | None
) -> uuid.UUID | None:
    """A folder deleted on another device mustn't cost the routine: it goes to no folder."""
    if folder_id is None:
        return None
    folder = await session.get(RoutineFolder, folder_id)
    usable = folder is not None and folder.user_id == user.id and folder.deleted_at is None
    return folder_id if usable else None


async def sync_routine(
    session: AsyncSession,
    user: User,
    routine_id: uuid.UUID,
    body: RoutineSync,
    limit: int | None,
) -> RoutineOut:
    await lock_changes(session, user.id)
    folder_id = await _usable_folder(session, user, body.folder_id)
    if await session.get(Routine, routine_id) is None:
        groups = _supersets(body.exercises)
        await _check_exercises(session, user, body.exercises, set())
        await _enforce_limit(session, user, limit)
        session.add(
            Routine(
                id=routine_id,
                user_id=user.id,
                folder_id=folder_id,
                name=body.name,
                notes=body.notes,
                position=body.position,
                exercises=build_exercises(body.exercises, groups),
            )
        )
        await _commit_new(session, "routine_exists", "A routine with this id already exists")
        return await get_routine(session, user, routine_id)

    routine = await _load(session, user, routine_id, for_update=True)
    changed = await _change_routine(
        session,
        user,
        routine,
        name=body.name,
        notes=body.notes,
        folder_id=folder_id,
        exercises=body.exercises,
        position=body.position,
    )
    if not changed:
        return routine_out(routine)
    routine.version += 1
    await session.commit()
    return await get_routine(session, user, routine.id)
