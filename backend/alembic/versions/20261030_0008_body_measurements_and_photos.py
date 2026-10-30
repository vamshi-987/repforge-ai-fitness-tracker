"""body measurements and progress photos

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-30 09:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = (
    "waist",
    "chest",
    "hips",
    "neck",
    "shoulders",
    "left_arm",
    "right_arm",
    "left_thigh",
    "right_thigh",
    "left_calf",
    "right_calf",
    "body_fat",
)
POSES = ("front", "side", "back")


def _syncable() -> list[sa.Column[object]]:
    return [
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "change_seq",
            sa.BigInteger(),
            server_default=sa.text("nextval('sync_change_seq')"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
    ]


def _sync_trigger(table: str) -> None:
    # Same cursor as every other syncable table (migration 0007).
    op.execute(
        f"CREATE TRIGGER {table}_change_seq BEFORE INSERT OR UPDATE ON {table} "
        "FOR EACH ROW EXECUTE FUNCTION set_change_seq()"
    )


def upgrade() -> None:
    op.create_table(
        "body_measurements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.Enum(*KINDS, name="measurement_kind"), nullable=False),
        sa.Column("value", sa.Numeric(precision=5, scale=1), nullable=False),
        *_syncable(),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_body_measurements_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_body_measurements")),
    )
    op.create_index(
        "ix_body_measurements_user_id_measured_at", "body_measurements", ["user_id", "measured_at"]
    )
    op.create_index(
        "ix_body_measurements_user_id_change_seq", "body_measurements", ["user_id", "change_seq"]
    )
    _sync_trigger("body_measurements")

    op.create_table(
        "progress_photos",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("object_key", sa.String(length=200), nullable=False),
        sa.Column("pose", sa.Enum(*POSES, name="photo_pose"), nullable=True),
        *_syncable(),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_progress_photos_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_progress_photos")),
        sa.UniqueConstraint("object_key", name=op.f("uq_progress_photos_object_key")),
    )
    op.create_index(
        "ix_progress_photos_user_id_taken_at", "progress_photos", ["user_id", "taken_at"]
    )
    op.create_index(
        "ix_progress_photos_user_id_change_seq", "progress_photos", ["user_id", "change_seq"]
    )
    _sync_trigger("progress_photos")


def downgrade() -> None:
    op.drop_table("progress_photos")
    op.drop_table("body_measurements")
    sa.Enum(name="photo_pose").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="measurement_kind").drop(op.get_bind(), checkfirst=True)
