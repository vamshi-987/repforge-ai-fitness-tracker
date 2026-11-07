import uuid
from datetime import datetime

from pydantic import BaseModel

from app.db.models import FoodSource


class ServingOut(BaseModel):
    label: str
    grams: float


class FoodOut(BaseModel):
    id: uuid.UUID
    name: str
    brand: str | None
    source: FoodSource
    barcode: str | None
    kcal_100g: float
    protein_100g: float
    carbs_100g: float
    fat_100g: float
    fiber_100g: float | None
    servings: list[ServingOut]
    is_custom: bool
    version: int
    updated_at: datetime


class FoodSearchOut(BaseModel):
    items: list[FoodOut]
    # True when an online source couldn't be reached: only local results are shown.
    partial: bool
