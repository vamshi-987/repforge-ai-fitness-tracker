"""weekly reports

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-06 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0012'
down_revision: str | None = '0011'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('weekly_reports',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('week_start', sa.Date(), nullable=False),
    sa.Column('avg_weight_kg', sa.Numeric(precision=6, scale=2, asdecimal=False), nullable=True),
    sa.Column('prev_avg_weight_kg', sa.Numeric(precision=6, scale=2, asdecimal=False), nullable=True),
    sa.Column('rate_pct', sa.Numeric(precision=6, scale=2, asdecimal=False), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('suggested_targets', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('headline', sa.String(length=200), nullable=False),
    sa.Column('tips', postgresql.ARRAY(sa.Text()), nullable=False),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('applied', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_weekly_reports_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_weekly_reports')),
    sa.UniqueConstraint('user_id', 'week_start', name=op.f('uq_weekly_reports_user_id'))
    )


def downgrade() -> None:
    op.drop_table('weekly_reports')
