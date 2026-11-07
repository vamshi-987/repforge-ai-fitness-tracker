"""workouts, sets, muscle sets and personal records

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VISIBILITIES = ("public", "followers", "private")
RECORD_TYPES = ("heaviest", "e1rm", "best_set_volume", "session_volume", "most_reps")


def _syncable() -> list[sa.Column[object]]:
    return [
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "workouts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("routine_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_volume_kg", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("total_sets", sa.Integer(), nullable=False),
        sa.Column(
            "visibility",
            sa.Enum(*VISIBILITIES, name="workout_visibility"),
            server_default="private",
            nullable=False,
        ),
        *_syncable(),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_workouts_routine_id_routines"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_workouts_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workouts")),
    )
    op.create_index(
        "ix_workouts_user_id_started_at",
        "workouts",
        ["user_id", sa.text("started_at DESC")],
    )

    op.create_table(
        "workout_exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workout_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("superset_group", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.ForeignKeyConstraint(
            ["exercise_id"],
            ["exercises.id"],
            name=op.f("fk_workout_exercises_exercise_id_exercises"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["workout_id"],
            ["workouts.id"],
            name=op.f("fk_workout_exercises_workout_id_workouts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workout_exercises")),
        sa.UniqueConstraint(
            "workout_id", "position", name="uq_workout_exercises_workout_id_position"
        ),
    )
    op.create_index("ix_workout_exercises_exercise_id", "workout_exercises", ["exercise_id"])

    op.create_table(
        "workout_sets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workout_exercise_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "set_type",
            postgresql.ENUM(name="set_type", create_type=False),
            server_default="normal",
            nullable=False,
        ),
        sa.Column("weight_kg", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("reps", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Integer(), nullable=True),
        sa.Column("distance_m", sa.Numeric(precision=9, scale=2), nullable=True),
        sa.Column("rpe", sa.Numeric(precision=3, scale=1), nullable=True),
        sa.Column("completed", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(
            ["workout_exercise_id"],
            ["workout_exercises.id"],
            name=op.f("fk_workout_sets_workout_exercise_id_workout_exercises"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workout_sets")),
        sa.UniqueConstraint(
            "workout_exercise_id",
            "position",
            name="uq_workout_sets_workout_exercise_id_position",
        ),
    )

    op.create_table(
        "workout_muscle_sets",
        sa.Column("workout_id", sa.Uuid(), nullable=False),
        sa.Column("muscle_id", sa.Uuid(), nullable=False),
        sa.Column("sets", sa.Numeric(precision=6, scale=1), nullable=False),
        sa.ForeignKeyConstraint(
            ["muscle_id"],
            ["muscles.id"],
            name=op.f("fk_workout_muscle_sets_muscle_id_muscles"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["workout_id"],
            ["workouts.id"],
            name=op.f("fk_workout_muscle_sets_workout_id_workouts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workout_id", "muscle_id", name=op.f("pk_workout_muscle_sets")),
    )

    op.create_table(
        "personal_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=False),
        sa.Column("record_type", sa.Enum(*RECORD_TYPES, name="record_type"), nullable=False),
        sa.Column("value", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("previous_value", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("workout_id", sa.Uuid(), nullable=False),
        sa.Column("workout_set_id", sa.Uuid(), nullable=True),
        sa.Column("achieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["exercise_id"],
            ["exercises.id"],
            name=op.f("fk_personal_records_exercise_id_exercises"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_personal_records_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workout_id"],
            ["workouts.id"],
            name=op.f("fk_personal_records_workout_id_workouts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workout_set_id"],
            ["workout_sets.id"],
            name=op.f("fk_personal_records_workout_set_id_workout_sets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_personal_records")),
    )
    op.create_index(
        "ix_personal_records_user_id_exercise_id",
        "personal_records",
        ["user_id", "exercise_id", "record_type"],
    )
    op.create_index("ix_personal_records_workout_id", "personal_records", ["workout_id"])


def downgrade() -> None:
    op.drop_index("ix_personal_records_workout_id", table_name="personal_records")
    op.drop_index("ix_personal_records_user_id_exercise_id", table_name="personal_records")
    op.drop_table("personal_records")
    op.drop_table("workout_muscle_sets")
    op.drop_table("workout_sets")
    op.drop_index("ix_workout_exercises_exercise_id", table_name="workout_exercises")
    op.drop_table("workout_exercises")
    op.drop_index("ix_workouts_user_id_started_at", table_name="workouts")
    op.drop_table("workouts")
    sa.Enum(name="record_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="workout_visibility").drop(op.get_bind(), checkfirst=True)
