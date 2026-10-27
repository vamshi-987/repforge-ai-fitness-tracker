import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.deps import CurrentUser, DbSession, RedisClient
from app.schemas.workouts import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    WorkoutOut,
    WorkoutPage,
    WorkoutPut,
)
from app.services import workouts as workout_service

router = APIRouter(tags=["workouts"])


@router.put(
    "/workouts/{workout_id}",
    response_model=WorkoutOut,
    responses={201: {"model": WorkoutOut, "description": "Created"}},
)
async def put_workout(
    workout_id: uuid.UUID,
    body: WorkoutPut,
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    response: Response,
) -> WorkoutOut:
    workout, created = await workout_service.put_workout(
        session, redis, user, workout_id, body, datetime.now(UTC)
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return workout


@router.get("/workouts", response_model=WorkoutPage)
async def list_workouts(
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> WorkoutPage:
    return await workout_service.list_workouts(session, user, cursor=cursor, limit=limit)


@router.get("/workouts/{workout_id}", response_model=WorkoutOut)
async def get_workout(workout_id: uuid.UUID, user: CurrentUser, session: DbSession) -> WorkoutOut:
    return await workout_service.get_workout(session, user, workout_id)


@router.delete("/workouts/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workout(
    workout_id: uuid.UUID, user: CurrentUser, session: DbSession, redis: RedisClient
) -> Response:
    await workout_service.delete_workout(session, redis, user, workout_id, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
