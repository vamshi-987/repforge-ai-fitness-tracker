import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status

from app.deps import AiDep, CurrentUser, DbSession, RedisClient, SettingsDep
from app.schemas.nutrition import (
    FoodDraft,
    FoodLogCopy,
    FoodLogIn,
    FoodLogOut,
    FoodLogUpdate,
    NutritionDay,
    ParseTextIn,
    PhotoAccepted,
    PhotoAnalysisOut,
    SavedMealIn,
    SavedMealLog,
    SavedMealOut,
    SavedMealUpdate,
    TargetsIn,
    TargetsOut,
)
from app.services import food_photos, food_text, nutrition
from app.services.storage import PhotoStore, S3PhotoStore
from app.workers.tasks.photo import analyze_photo

router = APIRouter(tags=["nutrition"])

DateQuery = Annotated[date | None, Query(alias="date")]
CREATED = status.HTTP_201_CREATED
NO_CONTENT = status.HTTP_204_NO_CONTENT


def _now() -> datetime:
    return datetime.now(UTC)


def get_photo_store(settings: SettingsDep) -> PhotoStore:
    return S3PhotoStore(settings)


def get_photo_queue() -> food_photos.Enqueue:
    return lambda analysis_id: analyze_photo.delay(str(analysis_id))


PhotoStoreDep = Annotated[PhotoStore, Depends(get_photo_store)]
PhotoQueue = Annotated[food_photos.Enqueue, Depends(get_photo_queue)]


# --- food logs --------------------------------------------------------------------------


@router.post("/food-logs", response_model=FoodLogOut, status_code=CREATED)
async def create_log(body: FoodLogIn, user: CurrentUser, session: DbSession) -> FoodLogOut:
    return await nutrition.create_log(session, user, body)


@router.post("/food-logs/copy", response_model=list[FoodLogOut], status_code=CREATED)
async def copy_logs(body: FoodLogCopy, user: CurrentUser, session: DbSession) -> list[FoodLogOut]:
    return await nutrition.copy_logs(session, user, body)


@router.get("/food-logs/{log_id}", response_model=FoodLogOut)
async def get_log(log_id: uuid.UUID, user: CurrentUser, session: DbSession) -> FoodLogOut:
    return await nutrition.get_log(session, user, log_id)


@router.patch("/food-logs/{log_id}", response_model=FoodLogOut)
async def update_log(
    log_id: uuid.UUID, body: FoodLogUpdate, user: CurrentUser, session: DbSession
) -> FoodLogOut:
    return await nutrition.update_log(session, user, log_id, body)


@router.delete("/food-logs/{log_id}", status_code=NO_CONTENT)
async def delete_log(log_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await nutrition.delete_log(session, user, log_id, _now())
    return Response(status_code=NO_CONTENT)


# --- the day and targets ----------------------------------------------------------------


@router.get("/nutrition/day", response_model=NutritionDay)
async def nutrition_day(
    user: CurrentUser, session: DbSession, day: DateQuery = None
) -> NutritionDay:
    return await nutrition.nutrition_day(session, user, day, _now())


@router.get("/nutrition/targets", response_model=TargetsOut)
async def get_targets(user: CurrentUser, session: DbSession, day: DateQuery = None) -> TargetsOut:
    return await nutrition.get_targets(session, user, day, _now())


@router.post("/nutrition/targets", response_model=TargetsOut, status_code=CREATED)
async def set_targets(body: TargetsIn, user: CurrentUser, session: DbSession) -> TargetsOut:
    return await nutrition.set_targets(session, user, body, _now())


# --- saved meals ------------------------------------------------------------------------


@router.get("/saved-meals", response_model=list[SavedMealOut])
async def list_saved_meals(user: CurrentUser, session: DbSession) -> list[SavedMealOut]:
    return await nutrition.list_saved_meals(session, user)


@router.post("/saved-meals", response_model=SavedMealOut, status_code=CREATED)
async def create_saved_meal(
    body: SavedMealIn, user: CurrentUser, session: DbSession
) -> SavedMealOut:
    return await nutrition.create_saved_meal(session, user, body)


@router.get("/saved-meals/{meal_id}", response_model=SavedMealOut)
async def get_saved_meal(meal_id: uuid.UUID, user: CurrentUser, session: DbSession) -> SavedMealOut:
    return await nutrition.get_saved_meal(session, user, meal_id)


@router.patch("/saved-meals/{meal_id}", response_model=SavedMealOut)
async def update_saved_meal(
    meal_id: uuid.UUID, body: SavedMealUpdate, user: CurrentUser, session: DbSession
) -> SavedMealOut:
    return await nutrition.update_saved_meal(session, user, meal_id, body)


@router.delete("/saved-meals/{meal_id}", status_code=NO_CONTENT)
async def delete_saved_meal(meal_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await nutrition.delete_saved_meal(session, user, meal_id, _now())
    return Response(status_code=NO_CONTENT)


@router.post("/saved-meals/{meal_id}/log", response_model=list[FoodLogOut], status_code=CREATED)
async def log_saved_meal(
    meal_id: uuid.UUID, body: SavedMealLog, user: CurrentUser, session: DbSession
) -> list[FoodLogOut]:
    return await nutrition.log_saved_meal(session, user, meal_id, body)


# --- food photos --------------------------------------------------------------------------


@router.post("/nutrition/photo", response_model=PhotoAccepted, status_code=status.HTTP_202_ACCEPTED)
async def analyze_food_photo(
    file: Annotated[UploadFile, File()],
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    settings: SettingsDep,
    ai: AiDep,
    store: PhotoStoreDep,
    enqueue: PhotoQueue,
) -> PhotoAccepted:
    """Start reading a food photo. Poll `GET /nutrition/photo/{id}` for the draft."""
    data = await file.read(settings.ai_photo_max_bytes + 1)
    return await food_photos.start_analysis(
        session, redis, settings, ai, store, enqueue, user, data, _now()
    )


@router.get("/nutrition/photo/{analysis_id}", response_model=PhotoAnalysisOut)
async def get_food_photo(
    analysis_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> PhotoAnalysisOut:
    return await food_photos.get_analysis(session, user, analysis_id, _now())


@router.post("/nutrition/parse-text", response_model=FoodDraft)
async def parse_food_text(
    body: ParseTextIn,
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    settings: SettingsDep,
    ai: AiDep,
) -> FoodDraft:
    return await food_text.parse_text(session, redis, settings, ai, user, body.text, _now())
