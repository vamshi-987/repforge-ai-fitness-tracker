"""Body tracking: weigh-ins (with weekly averages), measurements and progress photos.

Weigh-ins and measurements are offline-synced rows (client UUIDs, soft delete, `version`),
written through `put_*` by both REST and sync. Photos are uploaded straight to object
storage with a signed URL; the API stores only the object key and signs short-lived URLs to
read them, so the bucket stays private.
"""

import re
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.errors import ConflictError, NotFoundError
from app.db.change_lock import lock_changes
from app.db.models import BodyMeasurement, BodyWeight, MeasurementKind, ProgressPhoto, User
from app.schemas.body import (
    MeasurementIn,
    MeasurementOut,
    MeasurementUpdate,
    PhotoIn,
    PhotoOut,
    PhotoPage,
    WeekAverage,
    WeightHistory,
    WeightIn,
    WeightOut,
    WeightUpdate,
    check_measurement,
)
from app.schemas.stats import StatsRange
from app.services.profile import field_error, latest_weight_kg, load_profile, round_half_up
from app.services.stats import local_day, week_start
from app.services.storage import signed_url, user_prefix
from app.services.workouts import CLOCK_SKEW, decode_cursor, encode_cursor

# A weekly average needs this many weigh-ins (CLAUDE.md §4.2 A).
MIN_WEIGH_INS = 3
PHOTO_KEY = re.compile(r"^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|heic)$")


# --- pure helpers -----------------------------------------------------------------------


@dataclass(frozen=True)
class WeighIn:
    measured_at: datetime
    weight_kg: float


def weekly_averages(weigh_ins: Iterable[WeighIn], tz: ZoneInfo) -> list[WeekAverage]:
    """Mean weight per Monday week in the user's timezone, oldest first. A week with fewer
    than 3 weigh-ins has no average."""
    weeks: dict[date, list[float]] = defaultdict(list)
    for w in weigh_ins:
        weeks[week_start(local_day(w.measured_at, tz))].append(w.weight_kg)
    return [
        WeekAverage(
            week_start=week,
            weigh_ins=len(values),
            average_kg=(
                round_half_up(sum(values) / len(values), 2)
                if len(values) >= MIN_WEIGH_INS
                else None
            ),
        )
        for week, values in sorted(weeks.items())
    ]


def _not_future(moment: datetime, now: datetime, field: str) -> None:
    if moment > now + CLOCK_SKEW:
        raise field_error(field, f"{field} is in the future")


async def _owned[Row: (BodyWeight, BodyMeasurement, ProgressPhoto)](
    session: AsyncSession, model: type[Row], user: User, row_id: uuid.UUID, what: str
) -> Row:
    row = await session.get(model, row_id)
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise NotFoundError(f"{what} not found")
    return row


async def ensure_id_free(
    session: AsyncSession, model: Any, row_id: uuid.UUID | None, code: str
) -> None:
    if row_id is not None and await session.get(model, row_id) is not None:
        raise ConflictError(code, "This id is already used")


async def commit_new(session: AsyncSession, code: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(code, "This id is already used") from exc


def _apply(row: Any, changes: dict[str, Any]) -> bool:
    changed = False
    for name, value in changes.items():
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed = True
    if changed:
        row.version += 1
    return changed


# --- weights ----------------------------------------------------------------------------


async def put_weight(
    session: AsyncSession, user: User, weight_id: uuid.UUID, body: WeightIn, now: datetime
) -> WeightOut:
    """Create the weigh-in, or set it to this state if it exists (the sync upsert). The caller
    has checked that an existing row is the user's own and not deleted."""
    _not_future(body.measured_at, now, "measured_at")
    await lock_changes(session, user.id)
    fields = {
        "measured_at": body.measured_at,
        "weight_kg": round_half_up(body.weight_kg, 2),
        "source": body.source,
    }
    row = await session.get(BodyWeight, weight_id)
    if row is None:
        row = BodyWeight(id=weight_id, user_id=user.id, **fields)
        session.add(row)
        await commit_new(session, "weight_exists")
    elif _apply(row, fields):
        await session.commit()
    return WeightOut.model_validate(row)


async def create_weight(
    session: AsyncSession, user: User, body: WeightIn, now: datetime
) -> WeightOut:
    await ensure_id_free(session, BodyWeight, body.id, "weight_exists")
    return await put_weight(session, user, body.id or uuid.uuid4(), body, now)


async def update_weight(
    session: AsyncSession, user: User, weight_id: uuid.UUID, patch: WeightUpdate, now: datetime
) -> WeightOut:
    row = await _owned(session, BodyWeight, user, weight_id, "Weigh-in")
    changes = patch.changes()
    if "measured_at" in changes:
        _not_future(changes["measured_at"], now, "measured_at")
    if "weight_kg" in changes:
        changes["weight_kg"] = round_half_up(changes["weight_kg"], 2)
    if _apply(row, changes):
        await session.commit()
    return WeightOut.model_validate(row)


async def delete_weight(
    session: AsyncSession, user: User, weight_id: uuid.UUID, now: datetime
) -> None:
    row = await _owned(session, BodyWeight, user, weight_id, "Weigh-in")
    row.deleted_at = now
    row.version += 1
    await session.commit()


async def weight_history(
    session: AsyncSession, user: User, stats_range: StatsRange, now: datetime
) -> WeightHistory:
    query = select(BodyWeight).where(BodyWeight.user_id == user.id, BodyWeight.deleted_at.is_(None))
    if stats_range.span is not None:
        query = query.where(BodyWeight.measured_at >= now - stats_range.span)
    rows = list(await session.scalars(query.order_by(BodyWeight.measured_at.desc(), BodyWeight.id)))
    tz = ZoneInfo((await load_profile(session, user.id)).timezone)
    return WeightHistory(
        items=[WeightOut.model_validate(r) for r in rows],
        weeks=weekly_averages((WeighIn(r.measured_at, r.weight_kg) for r in rows), tz),
        latest_kg=await latest_weight_kg(session, user.id),
    )


# --- measurements -----------------------------------------------------------------------


async def put_measurement(
    session: AsyncSession,
    user: User,
    measurement_id: uuid.UUID,
    body: MeasurementIn,
    now: datetime,
) -> MeasurementOut:
    _not_future(body.measured_at, now, "measured_at")
    await lock_changes(session, user.id)
    fields = {
        "measured_at": body.measured_at,
        "kind": body.kind,
        "value": round_half_up(body.value, 1),
    }
    row = await session.get(BodyMeasurement, measurement_id)
    if row is None:
        row = BodyMeasurement(id=measurement_id, user_id=user.id, **fields)
        session.add(row)
        await commit_new(session, "measurement_exists")
    elif _apply(row, fields):
        await session.commit()
    return MeasurementOut.model_validate(row)


async def create_measurement(
    session: AsyncSession, user: User, body: MeasurementIn, now: datetime
) -> MeasurementOut:
    await ensure_id_free(session, BodyMeasurement, body.id, "measurement_exists")
    return await put_measurement(session, user, body.id or uuid.uuid4(), body, now)


async def update_measurement(
    session: AsyncSession,
    user: User,
    measurement_id: uuid.UUID,
    patch: MeasurementUpdate,
    now: datetime,
) -> MeasurementOut:
    row = await _owned(session, BodyMeasurement, user, measurement_id, "Measurement")
    changes = patch.changes()
    if "measured_at" in changes:
        _not_future(changes["measured_at"], now, "measured_at")
    if "value" in changes:
        try:
            check_measurement(row.kind, changes["value"])
        except ValueError as exc:
            raise field_error("value", str(exc)) from exc
        changes["value"] = round_half_up(changes["value"], 1)
    if _apply(row, changes):
        await session.commit()
    return MeasurementOut.model_validate(row)


async def delete_measurement(
    session: AsyncSession, user: User, measurement_id: uuid.UUID, now: datetime
) -> None:
    row = await _owned(session, BodyMeasurement, user, measurement_id, "Measurement")
    row.deleted_at = now
    row.version += 1
    await session.commit()


async def list_measurements(
    session: AsyncSession,
    user: User,
    kind: MeasurementKind | None,
    stats_range: StatsRange,
    now: datetime,
) -> list[MeasurementOut]:
    """Newest first."""
    query = select(BodyMeasurement).where(
        BodyMeasurement.user_id == user.id, BodyMeasurement.deleted_at.is_(None)
    )
    if kind is not None:
        query = query.where(BodyMeasurement.kind == kind)
    if stats_range.span is not None:
        query = query.where(BodyMeasurement.measured_at >= now - stats_range.span)
    rows = await session.scalars(
        query.order_by(BodyMeasurement.measured_at.desc(), BodyMeasurement.id)
    )
    return [MeasurementOut.model_validate(r) for r in rows]


# --- photos -----------------------------------------------------------------------------


def photo_out(settings: Settings, photo: ProgressPhoto, now: datetime) -> PhotoOut:
    ttl = settings.download_url_ttl_s
    return PhotoOut(
        id=photo.id,
        taken_at=photo.taken_at,
        pose=photo.pose,
        url=signed_url(
            settings, "GET", settings.s3_bucket_progress_photos, photo.object_key, now, ttl
        ),
        url_expires_at=now + timedelta(seconds=ttl),
        version=photo.version,
        created_at=photo.created_at,
    )


async def create_photo(
    session: AsyncSession, settings: Settings, user: User, body: PhotoIn, now: datetime
) -> PhotoOut:
    """Record an uploaded photo. The key must be one `POST /uploads/presign` gave this user."""
    if not body.object_key.startswith(user_prefix(user.id)) or not PHOTO_KEY.match(body.object_key):
        raise field_error("object_key", "not an upload of yours")
    _not_future(body.taken_at, now, "taken_at")
    await ensure_id_free(session, ProgressPhoto, body.id, "photo_exists")
    photo = ProgressPhoto(
        id=body.id or uuid.uuid4(),
        user_id=user.id,
        taken_at=body.taken_at,
        object_key=body.object_key,
        pose=body.pose,
    )
    session.add(photo)
    await commit_new(session, "photo_exists")
    return photo_out(settings, photo, now)


async def list_photos(
    session: AsyncSession,
    settings: Settings,
    user: User,
    *,
    cursor: str | None,
    limit: int,
    now: datetime,
) -> PhotoPage:
    """Newest first, with signed URLs."""
    query = (
        select(ProgressPhoto)
        .where(ProgressPhoto.user_id == user.id, ProgressPhoto.deleted_at.is_(None))
        .order_by(ProgressPhoto.taken_at.desc(), ProgressPhoto.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        taken_at, photo_id = decode_cursor(cursor)
        query = query.where(
            tuple_(ProgressPhoto.taken_at, ProgressPhoto.id) < tuple_(taken_at, photo_id)
        )
    rows = list(await session.scalars(query))
    page = rows[:limit]
    last = page[-1] if page else None
    return PhotoPage(
        items=[photo_out(settings, p, now) for p in page],
        next_cursor=(encode_cursor(last.taken_at, last.id) if last and len(rows) > limit else None),
    )


async def delete_photo(
    session: AsyncSession, user: User, photo_id: uuid.UUID, now: datetime
) -> None:
    """Soft delete. The stored object stays until the Phase 9 cleanup job removes it."""
    row = await _owned(session, ProgressPhoto, user, photo_id, "Photo")
    row.deleted_at = now
    row.version += 1
    await session.commit()
