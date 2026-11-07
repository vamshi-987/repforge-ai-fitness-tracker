"""sync cursor: change_seq on every syncable table

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-27 15:00:00+00:00

One global sequence numbers every insert and update of a syncable row. A trigger sets the
column, so no write path can forget it (raw SQL and bulk updates included).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# table → the column naming the owning user
SYNCABLE = {
    "body_weights": "user_id",
    "exercises": "owner_user_id",
    "routine_folders": "user_id",
    "routines": "user_id",
    "workouts": "user_id",
}


def upgrade() -> None:
    op.execute("CREATE SEQUENCE sync_change_seq AS BIGINT")
    op.execute(
        """
        CREATE FUNCTION set_change_seq() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.change_seq := nextval('sync_change_seq');
            RETURN NEW;
        END
        $$
        """
    )
    for table, owner in SYNCABLE.items():
        # The default numbers existing rows (in no particular order, which is fine: a first
        # pull reads everything).
        op.add_column(
            table,
            sa.Column(
                "change_seq",
                sa.BigInteger(),
                server_default=sa.text("nextval('sync_change_seq')"),
                nullable=False,
            ),
        )
        op.execute(
            f"CREATE TRIGGER {table}_change_seq BEFORE INSERT OR UPDATE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION set_change_seq()"
        )
        op.create_index(f"ix_{table}_{owner}_change_seq", table, [owner, "change_seq"])


def downgrade() -> None:
    for table, owner in SYNCABLE.items():
        op.drop_index(f"ix_{table}_{owner}_change_seq", table_name=table)
        op.execute(f"DROP TRIGGER {table}_change_seq ON {table}")
        op.drop_column(table, "change_seq")
    op.execute("DROP FUNCTION set_change_seq()")
    op.execute("DROP SEQUENCE sync_change_seq")
