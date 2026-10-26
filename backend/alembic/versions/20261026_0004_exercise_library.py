"""exercise library

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-26 00:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EXERCISE_TYPES = (
    "weight_reps",
    "bodyweight_reps",
    "weighted_bodyweight",
    "assisted_bodyweight",
    "duration",
    "distance_duration",
)


def _timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "equipment",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("increment_kg", sa.Numeric(precision=5, scale=2), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_equipment")),
        sa.UniqueConstraint("slug", name=op.f("uq_equipment_slug")),
    )
    op.create_table(
        "muscles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("body_map_key", sa.String(length=40), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_muscles")),
        sa.UniqueConstraint("slug", name=op.f("uq_muscles_slug")),
    )
    op.create_table(
        "exercises",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("type", sa.Enum(*EXERCISE_TYPES, name="exercise_type"), nullable=False),
        sa.Column("equipment_id", sa.Uuid(), nullable=False),
        sa.Column("primary_muscle_id", sa.Uuid(), nullable=False),
        sa.Column("media_video_url", sa.Text(), nullable=True),
        sa.Column("media_thumb_url", sa.Text(), nullable=True),
        sa.Column("media_license", sa.Text(), nullable=True),
        sa.Column(
            "instructions", sa.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False
        ),
        sa.Column("is_archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["equipment_id"],
            ["equipment.id"],
            name=op.f("fk_exercises_equipment_id_equipment"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name=op.f("fk_exercises_owner_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["primary_muscle_id"],
            ["muscles.id"],
            name=op.f("fk_exercises_primary_muscle_id_muscles"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_exercises")),
    )
    op.create_index("ix_exercises_owner_user_id", "exercises", ["owner_user_id"])
    # Fuzzy name search (ILIKE '%bench%' and word_similarity) uses this trigram index.
    op.create_index(
        "ix_exercises_name_trgm",
        "exercises",
        ["name"],
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )

    op.create_table(
        "exercise_secondary_muscles",
        sa.Column("exercise_id", sa.Uuid(), nullable=False),
        sa.Column("muscle_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["exercise_id"],
            ["exercises.id"],
            name=op.f("fk_exercise_secondary_muscles_exercise_id_exercises"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["muscle_id"],
            ["muscles.id"],
            name=op.f("fk_exercise_secondary_muscles_muscle_id_muscles"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "exercise_id", "muscle_id", name=op.f("pk_exercise_secondary_muscles")
        ),
    )
    op.create_index(
        "ix_exercise_secondary_muscles_muscle_id", "exercise_secondary_muscles", ["muscle_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_exercise_secondary_muscles_muscle_id", table_name="exercise_secondary_muscles"
    )
    op.drop_table("exercise_secondary_muscles")
    op.drop_index("ix_exercises_name_trgm", table_name="exercises")
    op.drop_index("ix_exercises_owner_user_id", table_name="exercises")
    op.drop_table("exercises")
    op.drop_table("muscles")
    op.drop_table("equipment")
    sa.Enum(name="exercise_type").drop(op.get_bind(), checkfirst=True)
