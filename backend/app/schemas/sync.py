import uuid
from enum import StrEnum
from typing import Annotated, Any, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.schemas.routines import FolderName, Notes, RoutineExercises, RoutineName

MAX_PUSH_CHANGES = 100
DEFAULT_PULL_LIMIT = 200
MAX_PULL_LIMIT = 500
MAX_POSITION = 100_000


class SyncEntity(StrEnum):
    """What the app syncs, in dependency order: exercises before the routines and workouts
    that use them, folders before the routines inside them."""

    EXERCISE = "exercise"
    ROUTINE_FOLDER = "routine_folder"
    ROUTINE = "routine"
    WORKOUT = "workout"
    BODY_WEIGHT = "body_weight"
    BODY_MEASUREMENT = "body_measurement"


class SyncOp(StrEnum):
    UPSERT = "upsert"
    DELETE = "delete"


class SyncStatus(StrEnum):
    APPLIED = "applied"
    # The server's copy changed after the one this edit was based on, and it is newer: the
    # edit is dropped and the server's copy returned (last write wins).
    STALE = "stale"
    REJECTED = "rejected"


# --- push -------------------------------------------------------------------------------


class SyncChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity: SyncEntity
    id: uuid.UUID
    op: SyncOp
    # The server version the edit started from; null for a row the device created.
    base_version: Annotated[int, Field(ge=0)] | None = None
    # When the edit was made on the device; breaks ties between conflicting edits.
    updated_at: AwareDatetime | None = None
    # The entity's full state for an upsert (validated per entity); omitted for a delete.
    data: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _upsert_has_data(self) -> Self:
        if self.op == SyncOp.UPSERT and self.data is None:
            raise ValueError("an upsert needs data")
        return self


class SyncPush(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changes: Annotated[list[SyncChangeIn], Field(max_length=MAX_PUSH_CHANGES)]


class SyncError(BaseModel):
    code: str
    message: str
    details: Any = None


class SyncResult(BaseModel):
    entity: SyncEntity
    id: uuid.UUID
    status: SyncStatus
    # True when the row no longer exists on the server (deleted, or never created).
    deleted: bool
    # The server's copy after this change, when the row exists.
    data: dict[str, Any] | None
    error: SyncError | None = None


class SyncPushOut(BaseModel):
    results: list[SyncResult]


# --- pull -------------------------------------------------------------------------------


class SyncChangeOut(BaseModel):
    entity: SyncEntity
    id: uuid.UUID
    change_seq: int
    deleted: bool
    # The row as its own endpoint returns it; null for a deletion.
    data: dict[str, Any] | None


class SyncPullOut(BaseModel):
    changes: list[SyncChangeOut]
    # Pass as `since` next time.
    cursor: int
    has_more: bool


# --- entity bodies that only sync uses --------------------------------------------------


class FolderSync(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FolderName
    position: Annotated[int, Field(ge=0, le=MAX_POSITION)] = 0


class RoutineSync(BaseModel):
    """A routine's full state. An unknown or deleted folder means "no folder"."""

    model_config = ConfigDict(extra="forbid")

    name: RoutineName
    notes: Notes = ""
    folder_id: uuid.UUID | None = None
    position: Annotated[int, Field(ge=0, le=MAX_POSITION)] = 0
    exercises: RoutineExercises = []
