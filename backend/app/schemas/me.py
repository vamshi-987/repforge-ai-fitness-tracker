from datetime import date, datetime, time
from functools import lru_cache
from typing import Annotated, ClassVar
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.db.models import (
    ActivityLevel,
    Experience,
    Goal,
    LengthUnit,
    Sex,
    Theme,
    WeightUnit,
)
from app.schemas.common import PatchModel
from app.schemas.user import DisplayName, Username, UserOut


@lru_cache
def _timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def _known_timezone(value: str) -> str:
    # A set lookup, not ZoneInfo(value): never lets user input reach the filesystem.
    if value not in _timezones():
        raise ValueError("unknown IANA timezone")
    return value


def _distinct_sorted(values: list[int]) -> list[int]:
    if len(set(values)) != len(values):
        raise ValueError("cup sizes must be distinct")
    return sorted(values)


Timezone = Annotated[str, Field(max_length=64), AfterValidator(_known_timezone)]
HeightCm = Annotated[float, Field(ge=100, le=250)]
WeightKg = Annotated[float, Field(ge=25, le=350)]
CupSizes = Annotated[
    list[Annotated[int, Field(ge=50, le=2000)]],
    Field(min_length=1, max_length=6),
    AfterValidator(_distinct_sorted),
]


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sex: Sex | None
    birth_date: date | None
    height_cm: float | None
    # Latest weigh-in (body_weights), not a profile column.
    weight_kg: float | None
    activity_level: ActivityLevel | None
    goal: Goal | None
    experience: Experience | None
    unit_weight: WeightUnit
    unit_length: LengthUnit
    water_goal_ml: int | None
    timezone: str
    onboarding_completed_at: datetime | None


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    theme: Theme
    default_rest_s: int
    keep_awake: bool
    show_burned_kcal: bool
    water_cup_sizes: list[int]
    water_reminder_every_h: int
    wake_time: time
    sleep_time: time
    reminders_enabled: bool


class MeOut(UserOut):
    profile: ProfileOut
    settings: SettingsOut
    onboarding_complete: bool


class MeUpdate(PatchModel):
    username: Username | None = None
    display_name: DisplayName | None = None
    is_private: bool | None = None


class ProfileUpdate(PatchModel):
    clearable: ClassVar[frozenset[str]] = frozenset({"water_goal_ml"})

    sex: Sex | None = None
    birth_date: date | None = None
    height_cm: HeightCm | None = None
    # Logged as a new weigh-in (body_weights), dated now.
    weight_kg: WeightKg | None = None
    activity_level: ActivityLevel | None = None
    goal: Goal | None = None
    experience: Experience | None = None
    unit_weight: WeightUnit | None = None
    unit_length: LengthUnit | None = None
    water_goal_ml: Annotated[int, Field(ge=500, le=10_000)] | None = None
    timezone: Timezone | None = None
    # true = finish onboarding; rejected with the missing fields unless all are answered.
    onboarding_complete: bool | None = None


class SettingsUpdate(PatchModel):
    theme: Theme | None = None
    default_rest_s: Annotated[int, Field(ge=0, le=900)] | None = None
    keep_awake: bool | None = None
    show_burned_kcal: bool | None = None
    water_cup_sizes: CupSizes | None = None
    water_reminder_every_h: Annotated[int, Field(ge=1, le=12)] | None = None
    wake_time: time | None = None
    sleep_time: time | None = None
    reminders_enabled: bool | None = None
