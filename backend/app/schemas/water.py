import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

AmountMl = Annotated[int, Field(ge=1, le=5000)]


class WaterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional client UUID, so the app can log offline and sync later.
    id: uuid.UUID | None = None
    # Defaults to now.
    logged_at: AwareDatetime | None = None
    amount_ml: AmountMl


class WaterLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    logged_at: datetime
    amount_ml: int
    version: int
    created_at: datetime
    updated_at: datetime


class WaterDay(BaseModel):
    # The user's local date.
    date: date
    goal_ml: int
    total_ml: int
    # A workout started that day, which adds to the goal.
    trained: bool
    # Oldest first.
    logs: list[WaterLogOut]


class WaterDayTotal(BaseModel):
    date: date
    total_ml: int
    goal_ml: int


class WaterHistory(BaseModel):
    # Every day of the range, oldest first (days without water included).
    days: list[WaterDayTotal]
