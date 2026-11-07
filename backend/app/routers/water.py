import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.deps import CurrentUser, DbSession
from app.schemas.stats import StatsRange
from app.schemas.water import WaterDay, WaterHistory, WaterIn, WaterLogOut
from app.services import water as water_service

router = APIRouter(tags=["water"])


@router.post("/water", response_model=WaterLogOut, status_code=status.HTTP_201_CREATED)
async def log_water(body: WaterIn, user: CurrentUser, session: DbSession) -> WaterLogOut:
    return await water_service.log_water(session, user, body, datetime.now(UTC))


@router.delete("/water/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_water(log_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await water_service.delete_water(session, user, log_id, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/water", response_model=WaterDay)
async def water_day(
    user: CurrentUser,
    session: DbSession,
    date: Annotated[str | None, Query(max_length=10)] = None,
) -> WaterDay:
    return await water_service.water_day(session, user, date, datetime.now(UTC))


@router.get("/water/history", response_model=WaterHistory)
async def water_history(
    user: CurrentUser,
    session: DbSession,
    stats_range: Annotated[StatsRange, Query(alias="range")] = StatsRange.MONTH,
) -> WaterHistory:
    return await water_service.water_history(session, user, stats_range, datetime.now(UTC))
