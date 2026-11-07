"""push tokens

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-07 13:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0015'
down_revision: str | None = '0014'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('push_tokens',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('expo_token', sa.String(length=200), nullable=False),
    sa.Column('platform', sa.String(length=10), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_push_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_push_tokens')),
    sa.UniqueConstraint('expo_token', name=op.f('uq_push_tokens_expo_token'))
    )
    op.create_index('ix_push_tokens_user_id', 'push_tokens', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_push_tokens_user_id', table_name='push_tokens')
    op.drop_table('push_tokens')
