import uuid
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import SyncableMixin
from app.db.models.exercise import Exercise
from app.db.types import str_enum


class SetType(StrEnum):
    """Shared by routine sets and (Phase 4) logged workout sets."""

    WARMUP = "warmup"
    NORMAL = "normal"
    DROP = "drop"
    FAILURE = "failure"


class RoutineFolder(SyncableMixin, Base):
    __tablename__ = "routine_folders"
    __table_args__ = (Index("ix_routine_folders_user_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(60))
    position: Mapped[int] = mapped_column(default=0, server_default="0")


class Routine(SyncableMixin, Base):
    """A workout template. The routine is the unit of change: its exercises and sets are
    replaced as a whole, and `version` goes up once per change."""

    __tablename__ = "routines"
    __table_args__ = (Index("ix_routines_user_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # NULL = not in a folder. Positions are counted per folder.
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("routine_folders.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(80))
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    position: Mapped[int] = mapped_column(default=0, server_default="0")

    exercises: Mapped[list["RoutineExercise"]] = relationship(
        lazy="raise",
        order_by="RoutineExercise.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RoutineExercise(Base):
    __tablename__ = "routine_exercises"
    __table_args__ = (
        UniqueConstraint("routine_id", "position", name="uq_routine_exercises_routine_id_position"),
        # "Which routines use this exercise?" (history and the overload coach).
        Index("ix_routine_exercises_exercise_id", "exercise_id"),
        CheckConstraint(
            "rep_range_min IS NULL OR rep_range_max IS NULL OR rep_range_min <= rep_range_max",
            name="rep_range_ordered",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    routine_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("routines.id", ondelete="CASCADE"))
    exercise_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exercises.id", ondelete="RESTRICT"))
    position: Mapped[int]
    # Adjacent exercises with the same number form a superset (1, 2, ... per routine).
    superset_group: Mapped[int | None]
    # NULL = the user's default rest (user_settings.default_rest_s).
    rest_seconds: Mapped[int | None]
    rep_range_min: Mapped[int | None]
    rep_range_max: Mapped[int | None]
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")

    exercise: Mapped[Exercise] = relationship(lazy="raise")
    sets: Mapped[list["RoutineSet"]] = relationship(
        lazy="raise",
        order_by="RoutineSet.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class RoutineSet(Base):
    __tablename__ = "routine_sets"
    __table_args__ = (
        UniqueConstraint(
            "routine_exercise_id", "position", name="uq_routine_sets_routine_exercise_id_position"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    routine_exercise_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("routine_exercises.id", ondelete="CASCADE")
    )
    position: Mapped[int]
    set_type: Mapped[SetType] = mapped_column(
        str_enum(SetType, "set_type"), default=SetType.NORMAL, server_default="normal"
    )
    target_weight_kg: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False))
    target_reps: Mapped[int | None]
    target_duration_s: Mapped[int | None]
