import uuid
from datetime import datetime, timedelta
from typing import Annotated, Self

from pydantic import AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.db.models import ExerciseType, RecordType, SetType, WorkoutVisibility

MAX_WORKOUT_EXERCISES = 50
MAX_SETS_PER_EXERCISE = 50
MAX_DURATION = timedelta(hours=24)
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50


def _collapse_spaces(value: object) -> object:
    return " ".join(value.split()) if isinstance(value, str) else value


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


Title = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=120)]
Notes = Annotated[str, BeforeValidator(_strip), Field(max_length=2000)]


# --- requests ---------------------------------------------------------------------------


class WorkoutSetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    set_type: SetType = SetType.NORMAL
    # Which values apply depends on the exercise type; the app sends only those.
    weight_kg: Annotated[float, Field(ge=0, le=1000)] | None = None
    reps: Annotated[int, Field(ge=0, le=1000)] | None = None
    duration_s: Annotated[int, Field(ge=0, le=24 * 3600)] | None = None
    distance_m: Annotated[float, Field(ge=0, le=1_000_000)] | None = None
    rpe: Annotated[float, Field(ge=1, le=10, multiple_of=0.5)] | None = None
    completed: bool = True


class WorkoutExerciseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_id: uuid.UUID
    # Adjacent exercises sharing a number form a superset (renumbered 1, 2, ... on save).
    superset_group: Annotated[int, Field(ge=1, le=MAX_WORKOUT_EXERCISES)] | None = None
    notes: Notes = ""
    sets: Annotated[list[WorkoutSetIn], Field(min_length=1, max_length=MAX_SETS_PER_EXERCISE)]


class WorkoutPut(BaseModel):
    """The whole finished workout. Sent again in full to change it."""

    model_config = ConfigDict(extra="forbid")

    title: Title
    notes: Notes = ""
    routine_id: uuid.UUID | None = None
    started_at: AwareDatetime
    ended_at: AwareDatetime
    visibility: WorkoutVisibility = WorkoutVisibility.PRIVATE
    exercises: Annotated[
        list[WorkoutExerciseIn], Field(min_length=1, max_length=MAX_WORKOUT_EXERCISES)
    ]

    @model_validator(mode="after")
    def _times_in_order(self) -> Self:
        if self.ended_at < self.started_at:
            raise ValueError("ended_at must not be before started_at")
        if self.ended_at - self.started_at > MAX_DURATION:
            raise ValueError("a workout can last at most 24 hours")
        return self


# --- responses --------------------------------------------------------------------------


class WorkoutSetOut(BaseModel):
    id: uuid.UUID
    set_type: SetType
    weight_kg: float | None
    reps: int | None
    duration_s: int | None
    distance_m: float | None
    rpe: float | None
    completed: bool


class WorkoutExerciseOut(BaseModel):
    id: uuid.UUID
    exercise_id: uuid.UUID
    # Read from the exercise, so history reads well after a custom exercise is deleted.
    exercise_name: str
    exercise_type: ExerciseType
    superset_group: int | None
    notes: str
    sets: list[WorkoutSetOut]


class RecordOut(BaseModel):
    exercise_id: uuid.UUID
    record_type: RecordType
    value: float
    # null = the first value for this record (a baseline, not a PR).
    previous_value: float | None
    # null for whole-session records (session volume).
    set_id: uuid.UUID | None


class WorkoutOut(BaseModel):
    id: uuid.UUID
    routine_id: uuid.UUID | None
    title: str
    notes: str
    started_at: datetime
    ended_at: datetime
    duration_s: int
    visibility: WorkoutVisibility
    total_volume_kg: float
    total_sets: int
    exercises: list[WorkoutExerciseOut]
    # Muscle slug → sets (primary 1, secondary 0.5 per completed working set).
    muscle_sets: dict[str, float]
    records: list[RecordOut]
    version: int
    created_at: datetime
    updated_at: datetime


class WorkoutPage(BaseModel):
    items: list[WorkoutOut]
    next_cursor: str | None
