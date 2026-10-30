import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import SyncableMixin
from app.db.types import str_enum


class WeightSource(StrEnum):
    MANUAL = "manual"
    HEALTH = "health"


class BodyWeight(SyncableMixin, Base):
    """One weigh-in. Created by onboarding in Phase 1; full CRUD and trends arrive in Phase 5."""

    __tablename__ = "body_weights"
    __table_args__ = (
        Index("ix_body_weights_user_id_measured_at", "user_id", "measured_at"),
        Index("ix_body_weights_user_id_change_seq", "user_id", "change_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    weight_kg: Mapped[float] = mapped_column(Numeric(5, 2, asdecimal=False))
    source: Mapped[WeightSource] = mapped_column(
        str_enum(WeightSource, "weight_source"), default=WeightSource.MANUAL
    )


class MeasurementKind(StrEnum):
    """Circumferences in cm, plus body fat in %."""

    WAIST = "waist"
    CHEST = "chest"
    HIPS = "hips"
    NECK = "neck"
    SHOULDERS = "shoulders"
    LEFT_ARM = "left_arm"
    RIGHT_ARM = "right_arm"
    LEFT_THIGH = "left_thigh"
    RIGHT_THIGH = "right_thigh"
    LEFT_CALF = "left_calf"
    RIGHT_CALF = "right_calf"
    BODY_FAT = "body_fat"


class BodyMeasurement(SyncableMixin, Base):
    __tablename__ = "body_measurements"
    __table_args__ = (
        Index("ix_body_measurements_user_id_measured_at", "user_id", "measured_at"),
        Index("ix_body_measurements_user_id_change_seq", "user_id", "change_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    kind: Mapped[MeasurementKind] = mapped_column(str_enum(MeasurementKind, "measurement_kind"))
    # cm, or % for body fat.
    value: Mapped[float] = mapped_column(Numeric(5, 1, asdecimal=False))


class PhotoPose(StrEnum):
    FRONT = "front"
    SIDE = "side"
    BACK = "back"


class ProgressPhoto(SyncableMixin, Base):
    """A progress photo. The image lives in object storage under `object_key`; the API hands
    out short-lived signed URLs, so the bucket stays private."""

    __tablename__ = "progress_photos"
    __table_args__ = (
        Index("ix_progress_photos_user_id_taken_at", "user_id", "taken_at"),
        Index("ix_progress_photos_user_id_change_seq", "user_id", "change_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    object_key: Mapped[str] = mapped_column(String(200), unique=True)
    pose: Mapped[PhotoPose | None] = mapped_column(str_enum(PhotoPose, "photo_pose"))
