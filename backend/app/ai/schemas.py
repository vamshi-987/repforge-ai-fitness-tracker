"""Every JSON shape the LLM may return. A reply that doesn't validate is never used."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

MAX_ITEMS = 30
MAX_TIPS = 4
MAX_TIP_CHARS = 240
MAX_EXPLANATION_CHARS = 160

Text = Annotated[str, Field(min_length=1, max_length=200)]
Grams = Annotated[float, Field(ge=0, le=5000)]


class FoodItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Text
    estimated_grams: Annotated[float, Field(gt=0, le=5000)]
    kcal: Annotated[float, Field(ge=0, le=20_000)]
    protein_g: Grams
    carbs_g: Grams
    fat_g: Grams
    confidence: Annotated[float, Field(ge=0, le=1)]
    match_query: Text


class FoodEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: Annotated[list[FoodItem], Field(max_length=MAX_ITEMS)]
    notes: Annotated[str, Field(max_length=500)]


Tip = Annotated[str, Field(min_length=1, max_length=MAX_TIP_CHARS)]


class WeeklyTips(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: Text
    tips: Annotated[list[Tip], Field(min_length=1, max_length=MAX_TIPS)]


class OverloadExplanation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    explanation: Annotated[str, Field(min_length=1, max_length=MAX_EXPLANATION_CHARS)]
