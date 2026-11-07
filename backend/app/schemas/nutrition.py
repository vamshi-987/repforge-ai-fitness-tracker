import uuid
from datetime import date, datetime
from typing import Annotated, ClassVar

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from app.db.models import AnalysisStatus, FoodSource, LogSource, Meal, TargetReason
from app.schemas.common import PatchModel

MAX_SERVINGS = 10
MAX_MEAL_ITEMS = 50


def _collapse_spaces(value: object) -> object:
    return " ".join(value.split()) if isinstance(value, str) else value


FoodName = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=200)]
BrandName = Annotated[str, BeforeValidator(_collapse_spaces), Field(max_length=120)]
MealName = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=80)]
UnitLabel = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=80)]
Kcal100 = Annotated[float, Field(ge=0, le=900)]
Grams100 = Annotated[float, Field(ge=0, le=100)]
Amount = Annotated[float, Field(gt=0, le=20_000)]
MacroGrams = Annotated[float, Field(ge=0, le=5000)]


# --- custom foods -----------------------------------------------------------------------


class ServingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: UnitLabel
    grams: Annotated[float, Field(gt=0, le=5000)]


Servings = Annotated[list[ServingIn], Field(max_length=MAX_SERVINGS)]


class FoodIn(BaseModel):
    """A custom food, per 100 g."""

    model_config = ConfigDict(extra="forbid")

    # Optional client UUID, so the app can create offline and sync later.
    id: uuid.UUID | None = None
    name: FoodName
    brand: BrandName | None = None
    barcode: Annotated[str, Field(pattern=r"^\d{8,14}$")] | None = None
    kcal_100g: Kcal100
    protein_100g: Grams100
    carbs_100g: Grams100
    fat_100g: Grams100
    fiber_100g: Grams100 | None = None
    servings: Servings = []


class FoodUpdate(PatchModel):
    clearable: ClassVar[frozenset[str]] = frozenset({"brand", "barcode", "fiber_100g"})

    name: FoodName | None = None
    brand: BrandName | None = None
    barcode: Annotated[str, Field(pattern=r"^\d{8,14}$")] | None = None
    kcal_100g: Kcal100 | None = None
    protein_100g: Grams100 | None = None
    carbs_100g: Grams100 | None = None
    fat_100g: Grams100 | None = None
    fiber_100g: Grams100 | None = None
    servings: Servings | None = None


# --- food logs --------------------------------------------------------------------------


class Per100gIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kcal: Kcal100
    protein: Grams100
    carbs: Grams100
    fat: Grams100
    fiber: Grams100 | None = None


class MacrosIn(BaseModel):
    """Macros the user typed in place of the scaled values."""

    model_config = ConfigDict(extra="forbid")

    protein_g: MacroGrams
    carbs_g: MacroGrams
    fat_g: MacroGrams
    fiber_g: MacroGrams | None = None


class FoodLogIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    log_date: date
    meal: Meal
    # With a food, `name` and `per_100g` default to its current values; without one
    # (a one-off entry), both are required.
    food_id: uuid.UUID | None = None
    name: FoodName | None = None
    brand: BrandName | None = None
    per_100g: Per100gIn | None = None
    quantity: Amount
    # "g", "ml", or a serving label.
    unit: UnitLabel
    grams: Amount
    macros: MacrosIn | None = None
    # An explicit calorie count, flagged "manual".
    kcal: Annotated[float, Field(ge=0, le=50_000)] | None = None
    source: LogSource = LogSource.MANUAL
    # The draft this entry was confirmed from.
    photo_analysis_id: uuid.UUID | None = None


class FoodLogUpdate(PatchModel):
    """`macros` or `kcal` set to null goes back to the scaled value."""

    clearable: ClassVar[frozenset[str]] = frozenset({"macros", "kcal"})

    log_date: date | None = None
    meal: Meal | None = None
    quantity: Amount | None = None
    unit: UnitLabel | None = None
    grams: Amount | None = None
    macros: MacrosIn | None = None
    kcal: Annotated[float, Field(ge=0, le=50_000)] | None = None


class FoodLogOut(BaseModel):
    id: uuid.UUID
    log_date: date
    meal: Meal
    food_id: uuid.UUID | None
    name: str
    brand: str | None
    per_100g: Per100gIn
    quantity: float
    unit: str
    grams: float
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float | None
    macros_overridden: bool
    kcal_overridden: bool
    source: LogSource
    photo_analysis_id: uuid.UUID | None
    version: int
    created_at: datetime
    updated_at: datetime


class FoodLogCopy(BaseModel):
    """Copy a day's logs, or one meal of it, to another day (and optionally another meal)."""

    model_config = ConfigDict(extra="forbid")

    from_date: date
    to_date: date
    from_meal: Meal | None = None
    to_meal: Meal | None = None


# --- the day ----------------------------------------------------------------------------


class NutritionTotals(BaseModel):
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float


class TargetsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kcal: Annotated[int, Field(ge=500, le=10_000)]
    protein_g: Annotated[int, Field(ge=0, le=1000)]
    carbs_g: Annotated[int, Field(ge=0, le=2000)]
    fat_g: Annotated[int, Field(ge=0, le=1000)]


class TargetsOut(BaseModel):
    effective_from: date
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    reason: TargetReason


class NutritionDay(BaseModel):
    date: date
    # Every meal is present, oldest entry first.
    meals: dict[Meal, list[FoodLogOut]]
    totals: NutritionTotals
    # null until onboarding has the data to compute them.
    targets: TargetsOut | None


# --- saved meals ------------------------------------------------------------------------


class SavedMealItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    food_id: uuid.UUID
    quantity: Amount
    unit: UnitLabel
    grams: Amount


SavedMealItems = Annotated[list[SavedMealItemIn], Field(min_length=1, max_length=MAX_MEAL_ITEMS)]


class SavedMealIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    name: MealName
    items: SavedMealItems


class SavedMealUpdate(PatchModel):
    name: MealName | None = None
    items: SavedMealItems | None = None


class SavedMealItemOut(BaseModel):
    food_id: uuid.UUID
    name: str
    source: FoodSource
    quantity: float
    unit: str
    grams: float
    # From the food's current values.
    per_100g: Per100gIn


class SavedMealOut(BaseModel):
    id: uuid.UUID
    name: str
    items: list[SavedMealItemOut]
    version: int
    updated_at: datetime


class SavedMealLog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    log_date: date
    meal: Meal


# --- AI drafts ----------------------------------------------------------------------------


class DraftItem(BaseModel):
    """One food the user still has to confirm. Amounts follow `per_100g`, the matched food's
    values when `food_id` is set and the model's estimate otherwise."""

    name: str
    food_id: uuid.UUID | None
    grams: float
    per_100g: Per100gIn
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fiber_g: float | None
    confidence: float


class FoodDraft(BaseModel):
    items: list[DraftItem]
    notes: str


class ParseTextIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=500)]


class PhotoAccepted(BaseModel):
    analysis_id: uuid.UUID


class PhotoAnalysisOut(BaseModel):
    id: uuid.UUID
    status: AnalysisStatus
    draft: FoodDraft | None
    # Why it failed, for logs and support. The app only offers manual entry.
    error: str | None
    created_at: datetime
