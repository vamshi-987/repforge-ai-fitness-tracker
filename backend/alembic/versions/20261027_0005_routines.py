"""routines

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27 00:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SET_TYPES = ("warmup", "normal", "drop", "failure")


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
        "routine_folders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        *_syncable(),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_routine_folders_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routine_folders")),
    )
    op.create_index("ix_routine_folders_user_id", "routine_folders", ["user_id"])

    op.create_table(
        "routines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        *_syncable(),
        sa.ForeignKeyConstraint(
            ["folder_id"],
            ["routine_folders.id"],
            name=op.f("fk_routines_folder_id_routine_folders"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_routines_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routines")),
    )
    op.create_index("ix_routines_user_id", "routines", ["user_id"])

    op.create_table(
        "routine_exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("routine_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("superset_group", sa.Integer(), nullable=True),
        sa.Column("rest_seconds", sa.Integer(), nullable=True),
        sa.Column("rep_range_min", sa.Integer(), nullable=True),
        sa.Column("rep_range_max", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.CheckConstraint(
            "rep_range_min IS NULL OR rep_range_max IS NULL OR rep_range_min <= rep_range_max",
            name=op.f("ck_routine_exercises_rep_range_ordered"),
        ),
        sa.ForeignKeyConstraint(
            ["exercise_id"],
            ["exercises.id"],
            name=op.f("fk_routine_exercises_exercise_id_exercises"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["routine_id"],
            ["routines.id"],
            name=op.f("fk_routine_exercises_routine_id_routines"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routine_exercises")),
        sa.UniqueConstraint(
            "routine_id", "position", name="uq_routine_exercises_routine_id_position"
        ),
    )
    op.create_index("ix_routine_exercises_exercise_id", "routine_exercises", ["exercise_id"])

    op.create_table(
        "routine_sets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("routine_exercise_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "set_type",
            sa.Enum(*SET_TYPES, name="set_type"),
            server_default="normal",
            nullable=False,
        ),
        sa.Column("target_weight_kg", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("target_reps", sa.Integer(), nullable=True),
        sa.Column("target_duration_s", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["routine_exercise_id"],
            ["routine_exercises.id"],
            name=op.f("fk_routine_sets_routine_exercise_id_routine_exercises"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routine_sets")),
        sa.UniqueConstraint(
            "routine_exercise_id",
            "position",
            name="uq_routine_sets_routine_exercise_id_position",
        ),
    )


def downgrade() -> None:
    op.drop_table("routine_sets")
    op.drop_index("ix_routine_exercises_exercise_id", table_name="routine_exercises")
    op.drop_table("routine_exercises")
    op.drop_index("ix_routines_user_id", table_name="routines")
    op.drop_table("routines")
    op.drop_index("ix_routine_folders_user_id", table_name="routine_folders")
    op.drop_table("routine_folders")
    sa.Enum(name="set_type").drop(op.get_bind(), checkfirst=True)
