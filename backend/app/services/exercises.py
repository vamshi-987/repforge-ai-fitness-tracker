"""Exercise library and custom exercises: search, caching, ETags and CRUD.

Listing merges two sources. The global library (about 400 rows, identical for everyone) is
cached in Redis under a key that contains the library version, so a re-seed makes every
old entry unreachable at once. A user's own custom exercises are few and change often, so
they are read live. Both are ranked together and paginated in memory with a keyset cursor.
"""

import base64
import binascii
import hashlib
import json
import logging
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import TypeAdapter
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import ColumnElement, and_, case, func, literal, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.errors import AppError, ConflictError, NotFoundError
from app.db.models import Equipment, Exercise, Muscle, User
from app.schemas.exercises import (
    EquipmentOut,
    ExerciseCreate,
    ExerciseDuplicate,
    ExerciseOut,
    ExercisePage,
    ExerciseUpdate,
    MuscleOut,
)
from app.services.exercise_search import SearchQuery, escape_like, normalize_query
from app.services.profile import field_error

logger = logging.getLogger(__name__)

LIBRARY_VERSION_KEY = "exlib:version"
# The version is derived from the database; the seed deletes this key, so the TTL only
# bounds staleness after a manual SQL edit.
LIBRARY_VERSION_TTL_S = 300
LIBRARY_CACHE_TTL_S = 3600
DEFAULT_PAGE_SIZE = 50
# Big enough to mirror the whole library to a phone in a single request.
MAX_PAGE_SIZE = 500
COPY_SUFFIX = " (Copy)"
NAME_MAX = 80

_items_adapter = TypeAdapter(list[ExerciseOut])

SortKey = tuple[float, str, str]


# --- pure helpers -----------------------------------------------------------------------


@dataclass(frozen=True)
class ExerciseFilters:
    q: SearchQuery | None = None
    # Primary muscle slugs; an exercise matches if its primary muscle is any of them.
    muscles: frozenset[str] = frozenset()
    equipment: frozenset[str] = frozenset()

    @classmethod
    def build(
        cls, q: str | None, muscles: Iterable[str], equipment: Iterable[str]
    ) -> "ExerciseFilters":
        return cls(
            q=normalize_query(q) if q else None,
            muscles=frozenset(muscles),
            equipment=frozenset(equipment),
        )

    def accepts(self, item: ExerciseOut) -> bool:
        return (not self.muscles or item.primary_muscle in self.muscles) and (
            not self.equipment or item.equipment in self.equipment
        )

    def fingerprint(self) -> str:
        return json.dumps(
            [self.q.text if self.q else None, sorted(self.muscles), sorted(self.equipment)]
        )


@dataclass(frozen=True)
class Ranked:
    item: ExerciseOut
    score: float

    @property
    def key(self) -> SortKey:
        # Best match first, then alphabetical; the id makes the order total for the cursor.
        return (-self.score, self.item.name.casefold(), str(self.item.id))


def encode_cursor(key: SortKey) -> str:
    return base64.urlsafe_b64encode(json.dumps(list(key)).encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> SortKey:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        score, name, ident = json.loads(base64.urlsafe_b64decode(padded))
        if not (
            isinstance(score, int | float) and isinstance(name, str) and isinstance(ident, str)
        ):
            raise ValueError
        return (float(score), name, ident)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise AppError("invalid_cursor", "Cursor is invalid", 422) from exc


def paginate(
    ranked: Sequence[Ranked], after: SortKey | None, limit: int
) -> tuple[list[ExerciseOut], str | None]:
    ordered = sorted(ranked, key=lambda r: r.key)
    if after is not None:
        ordered = [r for r in ordered if r.key > after]
    page = ordered[:limit]
    next_cursor = encode_cursor(page[-1].key) if len(ordered) > limit else None
    return [r.item for r in page], next_cursor


def make_etag(*parts: str) -> str:
    return 'W/"' + hashlib.sha256("|".join(parts).encode()).hexdigest()[:32] + '"'


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    """RFC 9110 weak comparison: `W/"x"` and `"x"` match; `*` matches anything."""
    if not if_none_match:
        return False

    def opaque(tag: str) -> str:
        tag = tag.strip()
        return tag[2:] if tag.startswith("W/") else tag

    return any(
        tag.strip() == "*" or opaque(tag) == opaque(etag) for tag in if_none_match.split(",")
    )


def copy_name(source: str) -> str:
    return source[: NAME_MAX - len(COPY_SUFFIX)].rstrip() + COPY_SUFFIX


def exercise_out(exercise: Exercise) -> ExerciseOut:
    return ExerciseOut(
        id=exercise.id,
        name=exercise.name,
        type=exercise.type,
        equipment=exercise.equipment.slug,
        primary_muscle=exercise.primary_muscle.slug,
        secondary_muscles=sorted(m.slug for m in exercise.secondary_muscles),
        instructions=list(exercise.instructions),
        media_video_url=exercise.media_video_url,
        media_thumb_url=exercise.media_thumb_url,
        media_license=exercise.media_license,
        is_custom=exercise.owner_user_id is not None,
        is_archived=exercise.is_archived,
        version=exercise.version,
        created_at=exercise.created_at,
        updated_at=exercise.updated_at,
    )


# --- cache (fails open: Redis down means slower, never broken) ---------------------------


async def _cache_get(redis: Redis, key: str) -> str | None:
    try:
        value: str | None = await redis.get(key)
    except RedisError as exc:
        logger.warning("cache_unavailable", extra={"key": key, "error": repr(exc)})
        return None
    return value


async def _cache_set(redis: Redis, key: str, value: str, ttl_s: int) -> None:
    try:
        await redis.set(key, value, ex=ttl_s)
    except RedisError as exc:
        logger.warning("cache_unavailable", extra={"key": key, "error": repr(exc)})


async def bust_library_cache(redis: Redis) -> None:
    """Forget the library version; entries under the old version expire on their own."""
    try:
        await redis.delete(LIBRARY_VERSION_KEY)
    except RedisError as exc:
        logger.warning("cache_unavailable", extra={"key": LIBRARY_VERSION_KEY, "error": repr(exc)})


async def library_version(session: AsyncSession, redis: Redis) -> str:
    cached = await _cache_get(redis, LIBRARY_VERSION_KEY)
    if cached:
        return cached
    exercises = (
        await session.execute(
            select(func.count(Exercise.id), func.max(Exercise.updated_at)).where(
                Exercise.owner_user_id.is_(None)
            )
        )
    ).one()
    muscles = await session.scalar(select(func.max(Muscle.updated_at)))
    equipment = await session.scalar(select(func.max(Equipment.updated_at)))
    raw = f"{exercises[0]}|{exercises[1]}|{muscles}|{equipment}"
    version = hashlib.sha256(raw.encode()).hexdigest()[:12]
    await _cache_set(redis, LIBRARY_VERSION_KEY, version, LIBRARY_VERSION_TTL_S)
    return version


# --- loading ----------------------------------------------------------------------------


def with_relations() -> tuple[Any, ...]:
    return (
        joinedload(Exercise.equipment),
        joinedload(Exercise.primary_muscle),
        selectinload(Exercise.secondary_muscles),
    )


def _search(q: SearchQuery) -> tuple[ColumnElement[bool], ColumnElement[float]]:
    """(match condition, relevance score) for a query.

    A name matches when it contains every token (ILIKE, served by the trigram index) or is
    fuzzily similar (`name %> q`: word_similarity >= pg_trgm's threshold, default 0.6), which
    catches typos like "bnch press". Prefix matches rank first, then contains-all, then by
    similarity.
    """
    contains_all = and_(
        *(Exercise.name.ilike(f"%{escape_like(token)}%", escape="\\") for token in q.tokens)
    )
    prefix = func.lower(Exercise.name).like(f"{escape_like(q.text)}%", escape="\\")
    match = or_(contains_all, Exercise.name.op("%>")(q.text))
    score = case((prefix, 2.0), (contains_all, 1.0), else_=0.0) + func.word_similarity(
        q.text, Exercise.name
    )
    return match, score


async def _library_items(session: AsyncSession, redis: Redis, version: str) -> list[ExerciseOut]:
    key = f"exlib:{version}:all"
    cached = await _cache_get(redis, key)
    if cached is not None:
        return _items_adapter.validate_json(cached)
    rows = await session.scalars(
        select(Exercise)
        .where(Exercise.owner_user_id.is_(None), Exercise.is_archived.is_(False))
        .options(*with_relations())
    )
    items = [exercise_out(row) for row in rows]
    await _cache_set(redis, key, _items_adapter.dump_json(items).decode(), LIBRARY_CACHE_TTL_S)
    return items


async def _library_scores(
    session: AsyncSession, redis: Redis, version: str, q: SearchQuery
) -> dict[str, float]:
    """Matching library exercise ids → relevance, cached per query text."""
    key = f"exlib:{version}:q:{hashlib.sha256(q.text.encode()).hexdigest()[:24]}"
    cached = await _cache_get(redis, key)
    if cached is not None:
        scores: dict[str, float] = json.loads(cached)
        return scores
    match, score = _search(q)
    rows = await session.execute(
        select(Exercise.id, score).where(
            Exercise.owner_user_id.is_(None), Exercise.is_archived.is_(False), match
        )
    )
    scores = {str(ident): float(value) for ident, value in rows.all()}
    await _cache_set(redis, key, json.dumps(scores), LIBRARY_CACHE_TTL_S)
    return scores


async def _custom_ranked(
    session: AsyncSession, user_id: uuid.UUID, q: SearchQuery | None
) -> list[Ranked]:
    if q is None:
        match: ColumnElement[bool] = literal(True)
        score: ColumnElement[float] = literal(0.0)
    else:
        match, score = _search(q)
    rows = await session.execute(
        select(Exercise, score)
        .where(Exercise.owner_user_id == user_id, Exercise.deleted_at.is_(None), match)
        .options(*with_relations())
    )
    return [Ranked(exercise_out(row[0]), float(row[1])) for row in rows.unique().all()]


async def custom_stamp(session: AsyncSession, user_id: uuid.UUID) -> str:
    """Changes whenever the user creates, edits or deletes a custom exercise."""
    row = (
        await session.execute(
            select(func.count(Exercise.id), func.max(Exercise.updated_at)).where(
                Exercise.owner_user_id == user_id
            )
        )
    ).one()
    return f"{row[0]}|{row[1]}"


# --- listing ----------------------------------------------------------------------------


@dataclass(frozen=True)
class ListResult:
    etag: str
    # None when the client's copy is current (304).
    page: ExercisePage | None


async def list_exercises(
    session: AsyncSession,
    redis: Redis,
    user: User,
    filters: ExerciseFilters,
    *,
    cursor: str | None,
    limit: int,
    if_none_match: str | None,
) -> ListResult:
    after = decode_cursor(cursor) if cursor else None
    version = await library_version(session, redis)
    etag = make_etag(
        version,
        await custom_stamp(session, user.id),
        filters.fingerprint(),
        cursor or "",
        str(limit),
    )
    if etag_matches(if_none_match, etag):
        return ListResult(etag, None)

    library = await _library_items(session, redis, version)
    if filters.q is None:
        ranked = [Ranked(item, 0.0) for item in library]
    else:
        scores = await _library_scores(session, redis, version, filters.q)
        ranked = [Ranked(item, scores[str(item.id)]) for item in library if str(item.id) in scores]
    ranked += await _custom_ranked(session, user.id, filters.q)

    items, next_cursor = paginate([r for r in ranked if filters.accepts(r.item)], after, limit)
    return ListResult(etag, ExercisePage(items=items, next_cursor=next_cursor))


async def list_muscles(session: AsyncSession) -> list[MuscleOut]:
    rows = await session.scalars(select(Muscle).order_by(Muscle.name))
    return [MuscleOut.model_validate(row) for row in rows]


async def list_equipment(session: AsyncSession) -> list[EquipmentOut]:
    rows = await session.scalars(select(Equipment).order_by(Equipment.name))
    return [EquipmentOut.model_validate(row) for row in rows]


# --- single exercises -------------------------------------------------------------------


def _not_found() -> NotFoundError:
    return NotFoundError("Exercise not found")


def _read_only() -> AppError:
    return AppError(
        "library_exercise_read_only",
        "Library exercises can't be changed. Duplicate it to make your own version.",
        403,
    )


async def _load(session: AsyncSession, user: User, exercise_id: uuid.UUID) -> Exercise:
    """A library exercise (archived ones too: history links to them) or one of the user's own."""
    exercise = await session.scalar(
        select(Exercise).where(Exercise.id == exercise_id).options(*with_relations())
    )
    if (
        exercise is None
        or exercise.deleted_at is not None
        or exercise.owner_user_id not in (None, user.id)
    ):
        raise _not_found()
    return exercise


async def _load_own(session: AsyncSession, user: User, exercise_id: uuid.UUID) -> Exercise:
    exercise = await _load(session, user, exercise_id)
    if exercise.owner_user_id is None:
        raise _read_only()
    return exercise


async def get_exercise(session: AsyncSession, user: User, exercise_id: uuid.UUID) -> ExerciseOut:
    return exercise_out(await _load(session, user, exercise_id))


async def _equipment(session: AsyncSession, slug: str) -> Equipment:
    equipment = await session.scalar(select(Equipment).where(Equipment.slug == slug))
    if equipment is None:
        raise field_error("equipment", f"unknown equipment {slug!r}")
    return equipment


async def _muscles(session: AsyncSession, field: str, slugs: Sequence[str]) -> list[Muscle]:
    found = {m.slug: m for m in await session.scalars(select(Muscle).where(Muscle.slug.in_(slugs)))}
    unknown = [slug for slug in slugs if slug not in found]
    if unknown:
        raise field_error(field, f"unknown muscle {unknown[0]!r}")
    return [found[slug] for slug in slugs]


def _check_primary_not_secondary(primary: str, secondary: Sequence[str]) -> None:
    if primary in secondary:
        raise field_error("secondary_muscles", "cannot include the primary muscle")


async def _ensure_id_free(session: AsyncSession, exercise_id: uuid.UUID | None) -> None:
    if exercise_id is not None and await session.get(Exercise, exercise_id) is not None:
        raise ConflictError("exercise_exists", "An exercise with this id already exists")


async def _save_new(session: AsyncSession, user: User, exercise: Exercise) -> ExerciseOut:
    session.add(exercise)
    try:
        await session.commit()
    except IntegrityError as exc:
        # Two creates with the same client id raced past _ensure_id_free.
        await session.rollback()
        raise ConflictError("exercise_exists", "An exercise with this id already exists") from exc
    return await get_exercise(session, user, exercise.id)


async def create_exercise(session: AsyncSession, user: User, body: ExerciseCreate) -> ExerciseOut:
    _check_primary_not_secondary(body.primary_muscle, body.secondary_muscles)
    equipment = await _equipment(session, body.equipment)
    (primary,) = await _muscles(session, "primary_muscle", [body.primary_muscle])
    secondary = await _muscles(session, "secondary_muscles", body.secondary_muscles)
    await _ensure_id_free(session, body.id)
    exercise = Exercise(
        id=body.id or uuid.uuid4(),
        owner_user_id=user.id,
        name=body.name,
        type=body.type,
        equipment=equipment,
        primary_muscle=primary,
        secondary_muscles=secondary,
        instructions=body.instructions,
    )
    return await _save_new(session, user, exercise)


async def update_exercise(
    session: AsyncSession, user: User, exercise_id: uuid.UUID, patch: ExerciseUpdate
) -> ExerciseOut:
    exercise = await _load_own(session, user, exercise_id)
    changes = patch.changes()

    new_type = changes.pop("type", exercise.type)
    if new_type != exercise.type:
        raise AppError(
            "exercise_type_immutable",
            "An exercise's type can't change after it is saved. Create a new exercise instead.",
            422,
            {"type": exercise.type.value},
        )

    primary_slug = changes.get("primary_muscle", exercise.primary_muscle.slug)
    secondary_slugs = changes.get(
        "secondary_muscles", sorted(m.slug for m in exercise.secondary_muscles)
    )
    _check_primary_not_secondary(primary_slug, secondary_slugs)

    before = exercise_out(exercise)
    if "name" in changes:
        exercise.name = changes["name"]
    if "instructions" in changes:
        exercise.instructions = changes["instructions"]
    if "equipment" in changes:
        exercise.equipment = await _equipment(session, changes["equipment"])
    if "primary_muscle" in changes:
        (exercise.primary_muscle,) = await _muscles(session, "primary_muscle", [primary_slug])
    if "secondary_muscles" in changes:
        exercise.secondary_muscles = await _muscles(session, "secondary_muscles", secondary_slugs)

    after = exercise_out(exercise)
    if after.model_dump(exclude={"updated_at"}) != before.model_dump(exclude={"updated_at"}):
        exercise.version += 1
        await session.commit()
    return exercise_out(exercise)


async def delete_exercise(
    session: AsyncSession, user: User, exercise_id: uuid.UUID, now: datetime
) -> None:
    exercise = await _load_own(session, user, exercise_id)
    # Soft delete: past workouts keep pointing at it, and other devices can sync the removal.
    exercise.deleted_at = now
    exercise.version += 1
    await session.commit()


async def duplicate_exercise(
    session: AsyncSession, user: User, exercise_id: uuid.UUID, body: ExerciseDuplicate
) -> ExerciseOut:
    source = await _load(session, user, exercise_id)
    await _ensure_id_free(session, body.id)
    copy = Exercise(
        id=body.id or uuid.uuid4(),
        owner_user_id=user.id,
        name=body.name or copy_name(source.name),
        type=source.type,
        equipment=source.equipment,
        primary_muscle=source.primary_muscle,
        secondary_muscles=list(source.secondary_muscles),
        instructions=list(source.instructions),
        media_video_url=source.media_video_url,
        media_thumb_url=source.media_thumb_url,
        media_license=source.media_license,
    )
    return await _save_new(session, user, copy)
