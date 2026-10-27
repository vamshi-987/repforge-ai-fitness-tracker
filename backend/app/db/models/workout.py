import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import SyncableMixin
from app.db.models.exercise import Exercise
from app.db.models.routine import SetType
from app.db.types import str_enum


class WorkoutVisibility(StrEnum):
    PUBLIC = "public"
    FOLLOWERS = "followers"
    PRIVATE = "private"


class RecordType(StrEnum):
    HEAVIEST = "heaviest"
    E1RM = "e1rm"
    BEST_SET_VOLUME = "best_set_volume"
    SESSION_VOLUME = "session_volume"
    MOST_REPS = "most_reps"


class Workout(SyncableMixin, Base):
    """A finished workout. Written as a whole by `PUT /workouts/{id}` under the client's UUID,
    so a retried save never duplicates it. Totals and muscle sets are computed on save."""

    __tablename__ = "workouts"
    __table_args__ = (Index("ix_workouts_user_id_started_at", "user_id", text("started_at DESC")),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Routines are soft-deleted, so the link survives a deleted routine.
    routine_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("routines.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(120))
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    total_volume_kg: Mapped[float] = mapped_column(Numeric(12, 2, asdecimal=False))
    total_sets: Mapped[int]
    visibility: Mapped[WorkoutVisibility] = mapped_column(
        str_enum(WorkoutVisibility, "workout_visibility"),
        default=WorkoutVisibility.PRIVATE,
        server_default="private",
    )

    exercises: Mapped[list["WorkoutExercise"]] = relationship(
        lazy="raise",
        order_by="WorkoutExercise.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"
    __table_args__ = (
        UniqueConstraint("workout_id", "position", name="uq_workout_exercises_workout_id_position"),
        # Exercise history and charts read every session of one exercise.
        Index("ix_workout_exercises_exercise_id", "exercise_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workout_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workouts.id", ondelete="CASCADE"))
    exercise_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exercises.id", ondelete="RESTRICT"))
    position: Mapped[int]
    superset_group: Mapped[int | None]
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")

    exercise: Mapped[Exercise] = relationship(lazy="raise")
    sets: Mapped[list["WorkoutSet"]] = relationship(
        lazy="raise",
        order_by="WorkoutSet.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class WorkoutSet(Base):
    __tablename__ = "workout_sets"
    __table_args__ = (
        UniqueConstraint(
            "workout_exercise_id", "position", name="uq_workout_sets_workout_exercise_id_position"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workout_exercise_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workout_exercises.id", ondelete="CASCADE")
    )
    position: Mapped[int]
    set_type: Mapped[SetType] = mapped_column(
        str_enum(SetType, "set_type"), default=SetType.NORMAL, server_default="normal"
    )
    weight_kg: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False))
    reps: Mapped[int | None]
    duration_s: Mapped[int | None]
    distance_m: Mapped[float | None] = mapped_column(Numeric(9, 2, asdecimal=False))
    rpe: Mapped[float | None] = mapped_column(Numeric(3, 1, asdecimal=False))
    completed: Mapped[bool] = mapped_column(default=True, server_default=true())


# Sets per muscle in one workout (primary 1, secondary 0.5): the stats heat map reads this
# instead of scanning sets.
workout_muscle_sets = Table(
    "workout_muscle_sets",
    Base.metadata,
    Column("workout_id", ForeignKey("workouts.id", ondelete="CASCADE"), primary_key=True),
    Column("muscle_id", ForeignKey("muscles.id", ondelete="RESTRICT"), primary_key=True),
    Column("sets", Numeric(6, 1, asdecimal=False), nullable=False),
)


class PersonalRecord(Base):
    """A new best reached in a workout. Records are recomputed from the user's history in
    start-time order, so they don't depend on the order workouts reach the server."""

    __tablename__ = "personal_records"
    __table_args__ = (
        Index("ix_personal_records_user_id_exercise_id", "user_id", "exercise_id", "record_type"),
        Index("ix_personal_records_workout_id", "workout_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    exercise_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exercises.id", ondelete="RESTRICT"))
    record_type: Mapped[RecordType] = mapped_column(str_enum(RecordType, "record_type"))
    value: Mapped[float] = mapped_column(Numeric(12, 2, asdecimal=False))
    # The best before this one; NULL = the first value (a baseline, not celebrated).
    previous_value: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False))
    workout_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workouts.id", ondelete="CASCADE"))
    # NULL for records over a whole session (session volume).
    workout_set_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workout_sets.id", ondelete="CASCADE")
    )
    achieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
