import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.db.models import MeasurementKind
from app.deps import CurrentUser, DbSession, SettingsDep
from app.schemas.body import (
    MeasurementIn,
    MeasurementOut,
    MeasurementUpdate,
    PhotoIn,
    PhotoOut,
    PhotoPage,
    WeightHistory,
    WeightIn,
    WeightOut,
    WeightUpdate,
)
from app.schemas.stats import StatsRange
from app.schemas.workouts import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.services import body as body_service

router = APIRouter(prefix="/body", tags=["body"])

RangeQuery = Annotated[StatsRange, Query(alias="range")]


def _now() -> datetime:
    return datetime.now(UTC)


# --- weights ----------------------------------------------------------------------------


@router.get("/weights", response_model=WeightHistory)
async def weight_history(
    user: CurrentUser, session: DbSession, stats_range: RangeQuery = StatsRange.QUARTER
) -> WeightHistory:
    return await body_service.weight_history(session, user, stats_range, _now())


@router.post("/weights", response_model=WeightOut, status_code=status.HTTP_201_CREATED)
async def create_weight(body: WeightIn, user: CurrentUser, session: DbSession) -> WeightOut:
    return await body_service.create_weight(session, user, body, _now())


@router.patch("/weights/{weight_id}", response_model=WeightOut)
async def update_weight(
    weight_id: uuid.UUID, body: WeightUpdate, user: CurrentUser, session: DbSession
) -> WeightOut:
    return await body_service.update_weight(session, user, weight_id, body, _now())


@router.delete("/weights/{weight_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_weight(weight_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await body_service.delete_weight(session, user, weight_id, _now())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- measurements -----------------------------------------------------------------------


@router.get("/measurements", response_model=list[MeasurementOut])
async def list_measurements(
    user: CurrentUser,
    session: DbSession,
    kind: MeasurementKind | None = None,
    stats_range: RangeQuery = StatsRange.ALL,
) -> list[MeasurementOut]:
    return await body_service.list_measurements(session, user, kind, stats_range, _now())


@router.post("/measurements", response_model=MeasurementOut, status_code=status.HTTP_201_CREATED)
async def create_measurement(
    body: MeasurementIn, user: CurrentUser, session: DbSession
) -> MeasurementOut:
    return await body_service.create_measurement(session, user, body, _now())


@router.patch("/measurements/{measurement_id}", response_model=MeasurementOut)
async def update_measurement(
    measurement_id: uuid.UUID, body: MeasurementUpdate, user: CurrentUser, session: DbSession
) -> MeasurementOut:
    return await body_service.update_measurement(session, user, measurement_id, body, _now())


@router.delete("/measurements/{measurement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_measurement(
    measurement_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> Response:
    await body_service.delete_measurement(session, user, measurement_id, _now())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- photos -----------------------------------------------------------------------------


@router.get("/photos", response_model=PhotoPage)
async def list_photos(
    user: CurrentUser,
    session: DbSession,
    settings: SettingsDep,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> PhotoPage:
    return await body_service.list_photos(
        session, settings, user, cursor=cursor, limit=limit, now=_now()
    )


@router.post("/photos", response_model=PhotoOut, status_code=status.HTTP_201_CREATED)
async def create_photo(
    body: PhotoIn, user: CurrentUser, session: DbSession, settings: SettingsDep
) -> PhotoOut:
    return await body_service.create_photo(session, settings, user, body, _now())


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(photo_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await body_service.delete_photo(session, user, photo_id, _now())
    return Response(status_code=status.HTTP_204_NO_CONTENT)
