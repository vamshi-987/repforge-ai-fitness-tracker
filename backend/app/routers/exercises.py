import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response, status

from app.deps import CurrentUser, DbSession, RedisClient
from app.schemas.exercises import (
    EquipmentOut,
    ExerciseCreate,
    ExerciseDuplicate,
    ExerciseOut,
    ExercisePage,
    ExerciseUpdate,
    MuscleOut,
)
from app.schemas.stats import ExerciseHistoryPage, ExerciseStatsOut, StatsRange
from app.schemas.workouts import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.services import exercise_stats
from app.services import exercises as exercise_service
from app.services.exercise_search import MAX_QUERY_LENGTH

router = APIRouter(tags=["exercises"])

# Per-user data (custom exercises) that must show up immediately: the client revalidates
# every time, and the ETag turns an unchanged response into an empty 304.
CACHE_CONTROL = "private, no-cache"


def _not_modified(etag: str) -> Response:
    return Response(
        status_code=status.HTTP_304_NOT_MODIFIED,
        headers={"ETag": etag, "Cache-Control": CACHE_CONTROL},
    )


@router.get("/exercises", response_model=ExercisePage)
async def list_exercises(
    response: Response,
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    q: Annotated[str | None, Query(max_length=MAX_QUERY_LENGTH)] = None,
    muscle: Annotated[list[str], Query()] = [],  # noqa: B006 (FastAPI copies defaults)
    equipment: Annotated[list[str], Query()] = [],  # noqa: B006
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[
        int, Query(ge=1, le=exercise_service.MAX_PAGE_SIZE)
    ] = exercise_service.DEFAULT_PAGE_SIZE,
    if_none_match: Annotated[str | None, Header()] = None,
) -> ExercisePage | Response:
    result = await exercise_service.list_exercises(
        session,
        redis,
        user,
        exercise_service.ExerciseFilters.build(q, muscle, equipment),
        cursor=cursor,
        limit=limit,
        if_none_match=if_none_match,
    )
    if result.page is None:
        return _not_modified(result.etag)
    response.headers["ETag"] = result.etag
    response.headers["Cache-Control"] = CACHE_CONTROL
    return result.page


@router.post("/exercises", response_model=ExerciseOut, status_code=status.HTTP_201_CREATED)
async def create_exercise(
    body: ExerciseCreate, user: CurrentUser, session: DbSession
) -> ExerciseOut:
    return await exercise_service.create_exercise(session, user, body)


@router.get("/exercises/{exercise_id}", response_model=ExerciseOut)
async def get_exercise(
    exercise_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ExerciseOut:
    return await exercise_service.get_exercise(session, user, exercise_id)


@router.patch("/exercises/{exercise_id}", response_model=ExerciseOut)
async def update_exercise(
    exercise_id: uuid.UUID, body: ExerciseUpdate, user: CurrentUser, session: DbSession
) -> ExerciseOut:
    return await exercise_service.update_exercise(session, user, exercise_id, body)


@router.delete("/exercises/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exercise(
    exercise_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> Response:
    await exercise_service.delete_exercise(session, user, exercise_id, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/exercises/{exercise_id}/duplicate",
    response_model=ExerciseOut,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_exercise(
    exercise_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    body: ExerciseDuplicate | None = None,
) -> ExerciseOut:
    return await exercise_service.duplicate_exercise(
        session, user, exercise_id, body or ExerciseDuplicate()
    )


async def _library_list_etag(session: DbSession, redis: RedisClient, name: str) -> str:
    version = await exercise_service.library_version(session, redis)
    return exercise_service.make_etag(version, name)


@router.get("/exercises/{exercise_id}/history", response_model=ExerciseHistoryPage)
async def exercise_history(
    exercise_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> ExerciseHistoryPage:
    return await exercise_stats.exercise_history(
        session, user, exercise_id, cursor=cursor, limit=limit
    )


@router.get("/exercises/{exercise_id}/stats", response_model=ExerciseStatsOut)
async def exercise_stats_view(
    exercise_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    stats_range: Annotated[StatsRange, Query(alias="range")] = StatsRange.QUARTER,
) -> ExerciseStatsOut:
    return await exercise_stats.exercise_stats(
        session, user, exercise_id, stats_range, datetime.now(UTC)
    )


@router.get("/muscles", response_model=list[MuscleOut])
async def list_muscles(
    response: Response,
    _: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    if_none_match: Annotated[str | None, Header()] = None,
) -> list[MuscleOut] | Response:
    etag = await _library_list_etag(session, redis, "muscles")
    if exercise_service.etag_matches(if_none_match, etag):
        return _not_modified(etag)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await exercise_service.list_muscles(session)


@router.get("/equipment", response_model=list[EquipmentOut])
async def list_equipment(
    response: Response,
    _: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    if_none_match: Annotated[str | None, Header()] = None,
) -> list[EquipmentOut] | Response:
    etag = await _library_list_etag(session, redis, "equipment")
    if exercise_service.etag_matches(if_none_match, etag):
        return _not_modified(etag)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = CACHE_CONTROL
    return await exercise_service.list_equipment(session)
