"""subscription events

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-08 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0016'
down_revision: str | None = '0015'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('subscription_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('rc_event_id', sa.String(length=100), nullable=False),
    sa.Column('type', sa.String(length=40), nullable=False),
    sa.Column('event_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_subscription_events_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscription_events')),
    sa.UniqueConstraint('rc_event_id', name=op.f('uq_subscription_events_rc_event_id'))
    )
    op.create_index('ix_subscription_events_user_id_event_at', 'subscription_events', ['user_id', 'event_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_subscription_events_user_id_event_at', table_name='subscription_events')
    op.drop_table('subscription_events')
