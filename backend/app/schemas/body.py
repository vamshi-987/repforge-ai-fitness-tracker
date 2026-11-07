import uuid
from datetime import date, datetime
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.db.models import MeasurementKind, PhotoPose, WeightSource
from app.schemas.common import PatchModel
from app.schemas.me import WeightKg

# Plausible ranges: circumferences in cm, body fat in %.
CM_RANGE = (10.0, 300.0)
BODY_FAT_RANGE = (2.0, 70.0)


def check_measurement(kind: MeasurementKind, value: float) -> None:
    low, high = BODY_FAT_RANGE if kind == MeasurementKind.BODY_FAT else CM_RANGE
    if not low <= value <= high:
        unit = "%" if kind == MeasurementKind.BODY_FAT else "cm"
        raise ValueError(f"{kind.value} must be between {low:g} and {high:g} {unit}")


# --- weights ----------------------------------------------------------------------------


class WeightIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional client UUID, so the app can log offline and sync later.
    id: uuid.UUID | None = None
    measured_at: AwareDatetime
    weight_kg: WeightKg
    source: WeightSource = WeightSource.MANUAL


class WeightUpdate(PatchModel):
    measured_at: AwareDatetime | None = None
    weight_kg: WeightKg | None = None


class WeightOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    measured_at: datetime
    weight_kg: float
    source: WeightSource
    version: int
    created_at: datetime
    updated_at: datetime


class WeekAverage(BaseModel):
    # Monday, in the user's timezone.
    week_start: date
    weigh_ins: int
    # null until the week has at least 3 weigh-ins: fewer say more about water than weight.
    average_kg: float | None


class WeightHistory(BaseModel):
    # Newest first.
    items: list[WeightOut]
    # Oldest first; only weeks with a weigh-in.
    weeks: list[WeekAverage]
    latest_kg: float | None


# --- measurements -----------------------------------------------------------------------


class MeasurementIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    measured_at: AwareDatetime
    kind: MeasurementKind
    value: float

    @model_validator(mode="after")
    def _plausible(self) -> Self:
        check_measurement(self.kind, self.value)
        return self


class MeasurementUpdate(PatchModel):
    measured_at: AwareDatetime | None = None
    value: float | None = None


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    measured_at: datetime
    kind: MeasurementKind
    value: float
    version: int
    created_at: datetime
    updated_at: datetime


# --- progress photos --------------------------------------------------------------------


class PhotoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    # From POST /uploads/presign, after the upload succeeded.
    object_key: Annotated[str, Field(min_length=1, max_length=200)]
    taken_at: AwareDatetime
    pose: PhotoPose | None = None


class PhotoOut(BaseModel):
    id: uuid.UUID
    taken_at: datetime
    pose: PhotoPose | None
    # Signed, short-lived: fetch again when it expires.
    url: str
    url_expires_at: datetime
    version: int
    created_at: datetime


class PhotoPage(BaseModel):
    items: list[PhotoOut]
    next_cursor: str | None


# --- uploads ----------------------------------------------------------------------------


class UploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["progress_photo"]
    content_type: Literal["image/jpeg", "image/png", "image/heic"]


class UploadOut(BaseModel):
    object_key: str
    upload_url: str
    method: Literal["PUT"] = "PUT"
    # Send these with the upload.
    headers: dict[str, str]
    expires_at: datetime
