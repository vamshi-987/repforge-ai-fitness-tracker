import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field

from app.db.models import ExerciseType
from app.schemas.common import PatchModel

MAX_SECONDARY_MUSCLES = 6
MAX_INSTRUCTIONS = 10


def _collapse_spaces(value: object) -> object:
    return " ".join(value.split()) if isinstance(value, str) else value


def _distinct(values: list[str]) -> list[str]:
    if len(set(values)) != len(values):
        raise ValueError("secondary muscles must be distinct")
    return sorted(values)


def _drop_blank_lines(values: list[str]) -> list[str]:
    return [line for line in values if line]


ExerciseName = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=80)]
SlugRef = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_]+$")]
SecondaryMuscles = Annotated[
    list[SlugRef], Field(max_length=MAX_SECONDARY_MUSCLES), AfterValidator(_distinct)
]
InstructionLine = Annotated[str, BeforeValidator(_collapse_spaces), Field(max_length=300)]
Instructions = Annotated[
    list[InstructionLine], Field(max_length=MAX_INSTRUCTIONS), AfterValidator(_drop_blank_lines)
]


class MuscleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    body_map_key: str


class EquipmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    increment_kg: float | None


class ExerciseOut(BaseModel):
    id: uuid.UUID
    name: str
    type: ExerciseType
    # Slugs; GET /muscles and GET /equipment give names and body map regions.
    equipment: str
    primary_muscle: str
    secondary_muscles: list[str]
    instructions: list[str]
    media_video_url: str | None
    media_thumb_url: str | None
    media_license: str | None
    is_custom: bool
    is_archived: bool
    version: int
    created_at: datetime
    updated_at: datetime


class ExercisePage(BaseModel):
    items: list[ExerciseOut]
    next_cursor: str | None


class ExerciseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional client-generated UUID, so an app can create offline and sync later.
    id: uuid.UUID | None = None
    name: ExerciseName
    type: ExerciseType
    equipment: SlugRef
    primary_muscle: SlugRef
    secondary_muscles: SecondaryMuscles = []
    instructions: Instructions = []


class ExerciseUpdate(PatchModel):
    name: ExerciseName | None = None
    # Accepted only when unchanged: an exercise's type is immutable after save.
    type: ExerciseType | None = None
    equipment: SlugRef | None = None
    primary_muscle: SlugRef | None = None
    secondary_muscles: SecondaryMuscles | None = None
    instructions: Instructions | None = None


class ExerciseDuplicate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    # Defaults to "<source name> (Copy)".
    name: ExerciseName | None = None
