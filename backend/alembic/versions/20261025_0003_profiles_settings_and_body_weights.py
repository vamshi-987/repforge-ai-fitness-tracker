"""profiles, settings and body weights

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-25 00:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENUMS = (
    "weight_source",
    "sex",
    "activity_level",
    "goal",
    "experience",
    "unit_weight",
    "unit_length",
    "theme",
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
        "body_weights",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("weight_kg", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("source", sa.Enum("manual", "health", name="weight_source"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_body_weights_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_body_weights")),
    )
    op.create_index(
        "ix_body_weights_user_id_measured_at", "body_weights", ["user_id", "measured_at"]
    )

    op.create_table(
        "user_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("sex", sa.Enum("male", "female", name="sex"), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("height_cm", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column(
            "activity_level",
            sa.Enum(
                "sedentary", "light", "moderate", "active", "very_active", name="activity_level"
            ),
            nullable=True,
        ),
        sa.Column(
            "goal", sa.Enum("muscle_gain", "fat_loss", "maintain", name="goal"), nullable=True
        ),
        sa.Column(
            "experience",
            sa.Enum("beginner", "intermediate", "advanced", name="experience"),
            nullable=True,
        ),
        sa.Column(
            "unit_weight",
            sa.Enum("kg", "lb", name="unit_weight"),
            server_default="kg",
            nullable=False,
        ),
        sa.Column(
            "unit_length",
            sa.Enum("cm", "in", name="unit_length"),
            server_default="cm",
            nullable=False,
        ),
        sa.Column("water_goal_ml", sa.Integer(), nullable=True),
        sa.Column("timezone", sa.String(length=64), server_default="UTC", nullable=False),
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_profiles_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_profiles")),
    )

    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "theme",
            sa.Enum("system", "light", "dark", name="theme"),
            server_default="system",
            nullable=False,
        ),
        sa.Column("default_rest_s", sa.Integer(), server_default="90", nullable=False),
        sa.Column("keep_awake", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "show_burned_kcal", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "water_cup_sizes",
            sa.ARRAY(sa.Integer()),
            server_default=sa.text("'{250,500,750}'"),
            nullable=False,
        ),
        sa.Column("water_reminder_every_h", sa.Integer(), server_default="2", nullable=False),
        sa.Column("wake_time", sa.Time(), server_default=sa.text("'07:00'"), nullable=False),
        sa.Column("sleep_time", sa.Time(), server_default=sa.text("'22:00'"), nullable=False),
        sa.Column(
            "reminders_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        *_timestamps(),
        sa.CheckConstraint(
            "wake_time <> sleep_time", name=op.f("ck_user_settings_wake_differs_from_sleep")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_settings_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_settings")),
    )

    # Accounts created before this migration get default rows, like new signups do.
    op.execute("INSERT INTO user_profiles (user_id) SELECT id FROM users")
    op.execute("INSERT INTO user_settings (user_id) SELECT id FROM users")


def downgrade() -> None:
    op.drop_table("user_settings")
    op.drop_table("user_profiles")
    op.drop_index("ix_body_weights_user_id_measured_at", table_name="body_weights")
    op.drop_table("body_weights")
    bind = op.get_bind()
    for name in ENUMS:
        sa.Enum(name=name).drop(bind, checkfirst=True)
