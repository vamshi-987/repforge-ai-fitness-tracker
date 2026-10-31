"""Offline sync: the app pushes a batch of changes, then pulls everything after its cursor.

**Push.** Each change is the full state of one row (or a delete), applied on its own through
the same service code as the REST endpoints, so the rules are identical. One bad change is
rejected without failing the batch. Writes are idempotent by the client's UUID.

**Conflicts.** A change carries the server `version` it was based on. If the server's copy
moved on since then, two devices edited the same row: the later edit by `updated_at` wins
(last write wins). A losing edit is answered `stale` with the server's copy. Deletes win
over edits. Finished workouts also follow the 24-hour rule (`workout_immutable`).

**Pull.** Every syncable row carries `change_seq` (app/db/change_lock.py explains why pulls
never skip one). A pull returns the user's rows with `change_seq > since` across all
entities, oldest first, and the new cursor.
"""

import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError
from app.db.change_lock import wait_for_changes
from app.db.mixins import SyncableMixin
from app.db.models import (
    BodyMeasurement,
    BodyWeight,
    Exercise,
    Routine,
    RoutineFolder,
    User,
    WaterLog,
    Workout,
)
from app.schemas.body import MeasurementIn, MeasurementOut, WeightIn, WeightOut
from app.schemas.exercises import ExerciseCreate, ExerciseUpdate
from app.schemas.routines import FolderOut
from app.schemas.sync import (
    FolderSync,
    RoutineSync,
    SyncChangeIn,
    SyncChangeOut,
    SyncEntity,
    SyncError,
    SyncOp,
    SyncPullOut,
    SyncPush,
    SyncPushOut,
    SyncResult,
    SyncStatus,
)
from app.schemas.water import WaterIn, WaterLogOut
from app.schemas.workouts import WorkoutPut
from app.services import body as body_service
from app.services import exercises as exercise_service
from app.services import routines as routine_service
from app.services import water as water_service
from app.services import workouts as workout_service

Json = dict[str, Any]


def is_stale(
    base_version: int | None,
    edited_at: datetime | None,
    server_version: int,
    server_updated_at: datetime,
) -> bool:
    """Whether an edit loses to the server's copy (last write wins).

    Only a real conflict can lose: the edit was based on an older version than the server
    has now. Then the newer of the two by time wins; an edit without a time loses.
    """
    if base_version is None or base_version >= server_version:
        return False
    return edited_at is None or edited_at < server_updated_at


@dataclass(frozen=True)
class Context:
    session: AsyncSession
    redis: Redis
    user: User
    routine_limit: int | None
    now: datetime


Upsert = Callable[[Context, uuid.UUID, Json], Awaitable[Json]]
Delete = Callable[[Context, uuid.UUID], Awaitable[None]]
Serialize = Callable[[AsyncSession, Sequence[Any]], Awaitable[list[Json]]]


@dataclass(frozen=True)
class Kind:
    model: type[SyncableMixin]
    owner_column: Any
    options: tuple[Any, ...]
    serialize: Serialize
    upsert: Upsert
    delete: Delete


# --- per entity ---------------------------------------------------------------------------


async def _exercise_upsert(ctx: Context, exercise_id: uuid.UUID, data: Json) -> Json:
    body = ExerciseCreate.model_validate({**data, "id": exercise_id})
    if await ctx.session.get(Exercise, exercise_id) is None:
        out = await exercise_service.create_exercise(ctx.session, ctx.user, body)
    else:
        patch = ExerciseUpdate(
            name=body.name,
            type=body.type,
            equipment=body.equipment,
            primary_muscle=body.primary_muscle,
            secondary_muscles=body.secondary_muscles,
            instructions=body.instructions,
        )
        out = await exercise_service.update_exercise(ctx.session, ctx.user, exercise_id, patch)
    return out.model_dump(mode="json")


async def _exercise_delete(ctx: Context, exercise_id: uuid.UUID) -> None:
    await exercise_service.delete_exercise(ctx.session, ctx.user, exercise_id, ctx.now)


async def _exercises_out(_: AsyncSession, rows: Sequence[Any]) -> list[Json]:
    return [exercise_service.exercise_out(row).model_dump(mode="json") for row in rows]


async def _folder_upsert(ctx: Context, folder_id: uuid.UUID, data: Json) -> Json:
    body = FolderSync.model_validate(data)
    out = await routine_service.sync_folder(ctx.session, ctx.user, folder_id, body)
    return out.model_dump(mode="json")


async def _folder_delete(ctx: Context, folder_id: uuid.UUID) -> None:
    await routine_service.delete_folder(ctx.session, ctx.user, folder_id, ctx.now)


async def _folders_out(_: AsyncSession, rows: Sequence[Any]) -> list[Json]:
    return [FolderOut.model_validate(row).model_dump(mode="json") for row in rows]


async def _routine_upsert(ctx: Context, routine_id: uuid.UUID, data: Json) -> Json:
    body = RoutineSync.model_validate(data)
    out = await routine_service.sync_routine(
        ctx.session, ctx.user, routine_id, body, ctx.routine_limit
    )
    return out.model_dump(mode="json")


async def _routine_delete(ctx: Context, routine_id: uuid.UUID) -> None:
    await routine_service.delete_routine(ctx.session, ctx.user, routine_id, ctx.now)


async def _routines_out(_: AsyncSession, rows: Sequence[Any]) -> list[Json]:
    return [routine_service.routine_out(row).model_dump(mode="json") for row in rows]


async def _workout_upsert(ctx: Context, workout_id: uuid.UUID, data: Json) -> Json:
    body = WorkoutPut.model_validate(data)
    out, _ = await workout_service.put_workout(
        ctx.session, ctx.redis, ctx.user, workout_id, body, ctx.now
    )
    return out.model_dump(mode="json")


async def _workout_delete(ctx: Context, workout_id: uuid.UUID) -> None:
    await workout_service.delete_workout(ctx.session, ctx.redis, ctx.user, workout_id, ctx.now)


async def _workouts_out(session: AsyncSession, rows: Sequence[Any]) -> list[Json]:
    return [w.model_dump(mode="json") for w in await workout_service.workouts_out(session, rows)]


async def _weight_upsert(ctx: Context, weight_id: uuid.UUID, data: Json) -> Json:
    body = WeightIn.model_validate(data)
    out = await body_service.put_weight(ctx.session, ctx.user, weight_id, body, ctx.now)
    return out.model_dump(mode="json")


async def _weight_delete(ctx: Context, weight_id: uuid.UUID) -> None:
    await body_service.delete_weight(ctx.session, ctx.user, weight_id, ctx.now)


async def _weights_out(_: AsyncSession, rows: Sequence[Any]) -> list[Json]:
    return [WeightOut.model_validate(row).model_dump(mode="json") for row in rows]


async def _measurement_upsert(ctx: Context, measurement_id: uuid.UUID, data: Json) -> Json:
    body = MeasurementIn.model_validate(data)
    out = await body_service.put_measurement(ctx.session, ctx.user, measurement_id, body, ctx.now)
    return out.model_dump(mode="json")


async def _measurement_delete(ctx: Context, measurement_id: uuid.UUID) -> None:
    await body_service.delete_measurement(ctx.session, ctx.user, measurement_id, ctx.now)


async def _measurements_out(_: AsyncSession, rows: Sequence[Any]) -> list[Json]:
    return [MeasurementOut.model_validate(row).model_dump(mode="json") for row in rows]


async def _water_upsert(ctx: Context, log_id: uuid.UUID, data: Json) -> Json:
    body = WaterIn.model_validate(data)
    out = await water_service.put_water(
        ctx.session, ctx.user, log_id, body.amount_ml, body.logged_at or ctx.now, ctx.now
    )
    return out.model_dump(mode="json")


async def _water_delete(ctx: Context, log_id: uuid.UUID) -> None:
    await water_service.delete_water(ctx.session, ctx.user, log_id, ctx.now)


async def _water_out(_: AsyncSession, rows: Sequence[Any]) -> list[Json]:
    return [WaterLogOut.model_validate(row).model_dump(mode="json") for row in rows]


KINDS: dict[SyncEntity, Kind] = {
    SyncEntity.EXERCISE: Kind(
        Exercise,
        Exercise.owner_user_id,
        exercise_service.with_relations(),
        _exercises_out,
        _exercise_upsert,
        _exercise_delete,
    ),
    SyncEntity.ROUTINE_FOLDER: Kind(
        RoutineFolder, RoutineFolder.user_id, (), _folders_out, _folder_upsert, _folder_delete
    ),
    SyncEntity.ROUTINE: Kind(
        Routine,
        Routine.user_id,
        routine_service.with_tree(),
        _routines_out,
        _routine_upsert,
        _routine_delete,
    ),
    SyncEntity.WORKOUT: Kind(
        Workout,
        Workout.user_id,
        workout_service.with_tree(),
        _workouts_out,
        _workout_upsert,
        _workout_delete,
    ),
    SyncEntity.BODY_WEIGHT: Kind(
        BodyWeight, BodyWeight.user_id, (), _weights_out, _weight_upsert, _weight_delete
    ),
    SyncEntity.BODY_MEASUREMENT: Kind(
        BodyMeasurement,
        BodyMeasurement.user_id,
        (),
        _measurements_out,
        _measurement_upsert,
        _measurement_delete,
    ),
    SyncEntity.WATER_LOG: Kind(
        WaterLog, WaterLog.user_id, (), _water_out, _water_upsert, _water_delete
    ),
}


async def _load(session: AsyncSession, kind: Kind, ids: Sequence[uuid.UUID]) -> list[Any]:
    model: Any = kind.model
    return list(
        await session.scalars(
            select(model)
            .where(model.id.in_(ids))
            .options(*kind.options)
            .execution_options(populate_existing=True)
        )
    )


# --- push ---------------------------------------------------------------------------------


def _result(change: SyncChangeIn, status: SyncStatus, data: Json | None) -> SyncResult:
    return SyncResult(
        entity=change.entity, id=change.id, status=status, deleted=data is None, data=data
    )


async def _current(ctx: Context, entity: SyncEntity, row_id: uuid.UUID) -> Json | None:
    """The server's copy as this user may see it; None if it doesn't exist for them."""
    kind = KINDS[entity]
    rows = await _load(ctx.session, kind, [row_id])
    if not rows or rows[0].deleted_at is not None:
        return None
    owner = rows[0].sync_owner_id
    # Library exercises (no owner) are everyone's.
    if owner != ctx.user.id and not (entity == SyncEntity.EXERCISE and owner is None):
        return None
    (data,) = await kind.serialize(ctx.session, rows)
    return data


async def _apply(ctx: Context, change: SyncChangeIn) -> SyncResult:
    kind = KINDS[change.entity]
    row: Any = await ctx.session.get(kind.model, change.id)
    deleting = change.op == SyncOp.DELETE

    if row is not None and row.sync_owner_id != ctx.user.id:
        if row.sync_owner_id is None:
            raise AppError("library_exercise_read_only", "Library exercises can't be changed", 403)
        if deleting:
            # Nothing of this user's exists under that id.
            return _result(change, SyncStatus.APPLIED, None)
        raise ConflictError(f"{change.entity}_exists", "This id belongs to another row")
    if row is not None and row.deleted_at is not None:
        if deleting:
            return _result(change, SyncStatus.APPLIED, None)
        raise ConflictError(f"{change.entity}_deleted", "It was deleted on another device")

    if deleting:
        if row is not None:
            await kind.delete(ctx, change.id)
        return _result(change, SyncStatus.APPLIED, None)

    if row is not None and is_stale(
        change.base_version, change.updated_at, row.version, row.updated_at
    ):
        return _result(change, SyncStatus.STALE, await _current(ctx, change.entity, change.id))

    assert change.data is not None  # SyncChangeIn guarantees it for upserts
    return _result(change, SyncStatus.APPLIED, await kind.upsert(ctx, change.id, change.data))


async def _apply_one(ctx: Context, change: SyncChangeIn) -> SyncResult:
    try:
        return await _apply(ctx, change)
    except AppError as exc:
        # Undo whatever this change wrote before it failed; earlier changes are committed.
        await ctx.session.rollback()
        await ctx.session.refresh(ctx.user)
        error = SyncError(code=exc.code, message=exc.message, details=exc.details)
    except ValidationError as exc:
        error = SyncError(
            code="validation_error",
            message="Request is invalid",
            details=[
                {"loc": ["data", *err["loc"]], "msg": err["msg"], "type": err["type"]}
                for err in exc.errors()
            ],
        )
    result = _result(change, SyncStatus.REJECTED, await _current(ctx, change.entity, change.id))
    result.error = error
    return result


async def push(
    session: AsyncSession,
    redis: Redis,
    user: User,
    body: SyncPush,
    *,
    routine_limit: int | None,
    now: datetime,
) -> SyncPushOut:
    """Apply the changes in order (the app sends exercises and folders before the routines
    and workouts that use them). Each one is answered on its own."""
    ctx = Context(session, redis, user, routine_limit, now)
    return SyncPushOut(results=[await _apply_one(ctx, change) for change in body.changes])


# --- pull ---------------------------------------------------------------------------------


async def pull(session: AsyncSession, user: User, *, since: int, limit: int) -> SyncPullOut:
    """The user's changes after `since`, oldest first. A first pull (`since=0`) leaves out
    deleted rows: a new device has nothing to delete."""
    await wait_for_changes(session, user.id)
    # 1. Which rows changed: (change_seq, entity, id, deleted), without loading them.
    found: list[tuple[int, SyncEntity, uuid.UUID, bool]] = []
    for entity, kind in KINDS.items():
        model: Any = kind.model
        query = (
            select(model.change_seq, model.id, model.deleted_at.is_not(None))
            .where(kind.owner_column == user.id, model.change_seq > since)
            .order_by(model.change_seq)
            .limit(limit + 1)
        )
        if since == 0:
            query = query.where(model.deleted_at.is_(None))
        found += [(seq, entity, row_id, gone) for seq, row_id, gone in await session.execute(query)]

    # Each table returned its oldest rows, so the oldest `limit` of all of them are exact.
    found.sort(key=lambda item: item[0])
    page = found[:limit]

    # 2. Load and serialize the live rows of the page, one entity at a time. (Loading
    # routines re-populates the exercises they join, so each entity is serialized before
    # the next one is loaded.)
    data: dict[uuid.UUID, Json] = {}
    for entity, kind in KINDS.items():
        rows = await _load(session, kind, [i for _, e, i, gone in page if e == entity and not gone])
        for row, serialized in zip(rows, await kind.serialize(session, rows), strict=True):
            data[row.id] = serialized
    return SyncPullOut(
        changes=[
            SyncChangeOut(
                entity=entity, id=row_id, change_seq=seq, deleted=gone, data=data.get(row_id)
            )
            for seq, entity, row_id, gone in page
        ],
        cursor=page[-1][0] if page else since,
        has_more=len(found) > limit,
    )
