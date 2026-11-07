import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Query, Response, status

from app.deps import CurrentUser, DbSession, RedisClient, SettingsDep
from app.schemas.foods import FoodOut, FoodSearchOut
from app.schemas.nutrition import FoodIn, FoodUpdate
from app.services import food_search, nutrition

router = APIRouter(tags=["foods"])


async def get_food_http(settings: SettingsDep) -> AsyncIterator[httpx.AsyncClient]:
    """The client for USDA and Open Food Facts; tests swap in a recorded transport."""
    async with httpx.AsyncClient(timeout=settings.food_http_timeout_s) as client:
        yield client


FoodHttp = Annotated[httpx.AsyncClient, Depends(get_food_http)]


@router.get("/foods/search", response_model=FoodSearchOut)
async def search_foods(
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    http: FoodHttp,
    settings: SettingsDep,
    q: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
) -> FoodSearchOut:
    return await food_search.search_foods(session, redis, http, settings, user, q, limit)


@router.get("/foods/barcode/{code}", response_model=FoodOut)
async def food_by_barcode(
    code: str, user: CurrentUser, session: DbSession, redis: RedisClient, http: FoodHttp
) -> FoodOut:
    return await food_search.food_by_barcode(session, redis, http, user, code)


@router.get("/foods/{food_id}", response_model=FoodOut)
async def get_food(food_id: uuid.UUID, user: CurrentUser, session: DbSession) -> FoodOut:
    return await food_search.get_food(session, user, food_id)


@router.post("/foods", response_model=FoodOut, status_code=status.HTTP_201_CREATED)
async def create_food(body: FoodIn, user: CurrentUser, session: DbSession) -> FoodOut:
    return await nutrition.create_food(session, user, body)


@router.patch("/foods/{food_id}", response_model=FoodOut)
async def update_food(
    food_id: uuid.UUID, body: FoodUpdate, user: CurrentUser, session: DbSession
) -> FoodOut:
    return await nutrition.update_food(session, user, food_id, body)


@router.delete("/foods/{food_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_food(food_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await nutrition.delete_food(session, user, food_id, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
