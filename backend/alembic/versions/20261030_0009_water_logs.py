"""water logs

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-30 14:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "water_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("logged_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount_ml", sa.Integer(), nullable=False),
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
        sa.CheckConstraint(
            "amount_ml > 0 AND amount_ml <= 5000", name=op.f("ck_water_logs_amount_in_range")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_water_logs_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_water_logs")),
    )
    op.create_index("ix_water_logs_user_id_logged_at", "water_logs", ["user_id", "logged_at"])
    op.create_index("ix_water_logs_user_id_change_seq", "water_logs", ["user_id", "change_seq"])
    # The sync cursor, like every other syncable table (migration 0007).
    op.execute(
        "CREATE TRIGGER water_logs_change_seq BEFORE INSERT OR UPDATE ON water_logs "
        "FOR EACH ROW EXECUTE FUNCTION set_change_seq()"
    )


def downgrade() -> None:
    op.drop_table("water_logs")
