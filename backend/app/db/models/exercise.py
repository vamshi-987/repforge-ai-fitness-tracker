import uuid
from enum import StrEnum

from sqlalchemy import (
    ARRAY,
    Column,
    ForeignKey,
    Index,
    Numeric,
    String,
    Table,
    Text,
    false,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import SyncableMixin, TimestampMixin
from app.db.types import str_enum


class ExerciseType(StrEnum):
    """Which inputs a set takes. Immutable once an exercise is saved (history depends on it)."""

    WEIGHT_REPS = "weight_reps"
    BODYWEIGHT_REPS = "bodyweight_reps"
    WEIGHTED_BODYWEIGHT = "weighted_bodyweight"
    ASSISTED_BODYWEIGHT = "assisted_bodyweight"
    DURATION = "duration"
    DISTANCE_DURATION = "distance_duration"


class Muscle(TimestampMixin, Base):
    __tablename__ = "muscles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    # Region id in the mobile SVG body map (CLAUDE.md §8).
    body_map_key: Mapped[str] = mapped_column(String(40))


class Equipment(TimestampMixin, Base):
    __tablename__ = "equipment"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    # Smallest load step for the overload coach. NULL = progress by reps (bodyweight, bands).
    increment_kg: Mapped[float | None] = mapped_column(Numeric(5, 2, asdecimal=False))


exercise_secondary_muscles = Table(
    "exercise_secondary_muscles",
    Base.metadata,
    Column(
        "exercise_id",
        ForeignKey("exercises.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("muscle_id", ForeignKey("muscles.id", ondelete="RESTRICT"), primary_key=True),
    # The primary key leads with exercise_id; the muscle filter looks up by muscle.
    Index("ix_exercise_secondary_muscles_muscle_id", "muscle_id"),
)


class Exercise(SyncableMixin, Base):
    """A library exercise (`owner_user_id` NULL, seeded) or a user's custom exercise.

    Library rows are never deleted: one that leaves the seed is archived, because past workouts
    still point at it. Custom rows are soft-deleted (`deleted_at`) so the deletion can sync.
    """

    __tablename__ = "exercises"
    __table_args__ = (
        Index("ix_exercises_owner_user_id", "owner_user_id"),
        Index(
            "ix_exercises_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[ExerciseType] = mapped_column(str_enum(ExerciseType, "exercise_type"))
    equipment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment.id", ondelete="RESTRICT"))
    primary_muscle_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("muscles.id", ondelete="RESTRICT")
    )
    media_video_url: Mapped[str | None] = mapped_column(Text)
    media_thumb_url: Mapped[str | None] = mapped_column(Text)
    # Required in production for every media URL (CLAUDE.md §13).
    media_license: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'")
    )
    is_archived: Mapped[bool] = mapped_column(default=False, server_default=false())

    equipment: Mapped[Equipment] = relationship(lazy="raise")
    primary_muscle: Mapped[Muscle] = relationship(lazy="raise")
    secondary_muscles: Mapped[list[Muscle]] = relationship(
        secondary=exercise_secondary_muscles, lazy="raise", order_by=Muscle.slug
    )
