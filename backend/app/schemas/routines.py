import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.db.models import ExerciseType, SetType
from app.schemas.common import PatchModel

MAX_ROUTINE_EXERCISES = 50
MAX_SETS_PER_EXERCISE = 30
MAX_REST_S = 15 * 60
MAX_REORDER = 500


def _collapse_spaces(value: object) -> object:
    return " ".join(value.split()) if isinstance(value, str) else value


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


def _distinct_ids(values: list[uuid.UUID]) -> list[uuid.UUID]:
    if len(set(values)) != len(values):
        raise ValueError("ids must be distinct")
    return values


RoutineName = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=80)]
FolderName = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=60)]
Notes = Annotated[str, BeforeValidator(_strip), Field(max_length=2000)]
RepCount = Annotated[int, Field(ge=1, le=100)]
OrderedIds = Annotated[
    list[uuid.UUID], Field(max_length=MAX_REORDER), AfterValidator(_distinct_ids)
]


# --- requests ---------------------------------------------------------------------------


class RoutineSetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    set_type: SetType = SetType.NORMAL
    # Which targets apply depends on the exercise type; the app sends only those.
    target_weight_kg: Annotated[float, Field(ge=0, le=1000)] | None = None
    target_reps: Annotated[int, Field(ge=0, le=1000)] | None = None
    target_duration_s: Annotated[int, Field(ge=0, le=24 * 3600)] | None = None


class RoutineExerciseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exercise_id: uuid.UUID
    # Adjacent exercises sharing a number form a superset. The server renumbers groups
    # 1, 2, ... in order and drops one-exercise groups.
    superset_group: Annotated[int, Field(ge=1, le=MAX_ROUTINE_EXERCISES)] | None = None
    # NULL = the user's default rest time.
    rest_seconds: Annotated[int, Field(ge=0, le=MAX_REST_S)] | None = None
    rep_range_min: RepCount | None = None
    rep_range_max: RepCount | None = None
    notes: Notes = ""
    sets: Annotated[list[RoutineSetIn], Field(max_length=MAX_SETS_PER_EXERCISE)] = []

    @model_validator(mode="after")
    def _rep_range_ordered(self) -> Self:
        if (
            self.rep_range_min is not None
            and self.rep_range_max is not None
            and self.rep_range_min > self.rep_range_max
        ):
            raise ValueError("rep_range_min must not be greater than rep_range_max")
        return self


RoutineExercises = Annotated[list[RoutineExerciseIn], Field(max_length=MAX_ROUTINE_EXERCISES)]


class RoutineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional client-generated UUID, so the app can create offline and sync later.
    id: uuid.UUID | None = None
    name: RoutineName
    notes: Notes = ""
    folder_id: uuid.UUID | None = None
    exercises: RoutineExercises = []


class RoutineUpdate(PatchModel):
    """`exercises`, when sent, replaces the routine's whole exercise list."""

    clearable = frozenset({"folder_id"})

    name: RoutineName | None = None
    notes: Notes | None = None
    folder_id: uuid.UUID | None = None
    exercises: RoutineExercises | None = None


class RoutineDuplicate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    # Defaults to "<source name> (Copy)".
    name: RoutineName | None = None


class RoutineReorder(BaseModel):
    """Put these routines, in this order, into one folder (or none)."""

    model_config = ConfigDict(extra="forbid")

    folder_id: uuid.UUID | None = None
    routine_ids: OrderedIds


class FolderCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    name: FolderName


class FolderUpdate(PatchModel):
    name: FolderName | None = None


class FolderReorder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    folder_ids: OrderedIds


# --- responses --------------------------------------------------------------------------


class RoutineSetOut(BaseModel):
    set_type: SetType
    target_weight_kg: float | None
    target_reps: int | None
    target_duration_s: int | None


class RoutineExerciseOut(BaseModel):
    exercise_id: uuid.UUID
    # Copied from the exercise, so a routine still reads well if a custom exercise is deleted.
    exercise_name: str
    exercise_type: ExerciseType
    superset_group: int | None
    rest_seconds: int | None
    rep_range_min: int | None
    rep_range_max: int | None
    notes: str
    sets: list[RoutineSetOut]


class RoutineOut(BaseModel):
    id: uuid.UUID
    folder_id: uuid.UUID | None
    name: str
    notes: str
    position: int
    exercises: list[RoutineExerciseOut]
    version: int
    created_at: datetime
    updated_at: datetime


class RoutineList(BaseModel):
    items: list[RoutineOut]
    # How many routines the caller may have; null = unlimited (Pro).
    routine_limit: int | None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    position: int
    version: int
    created_at: datetime
    updated_at: datetime
