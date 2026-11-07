"""photo analyses: food photos on their way to a draft

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-05 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0011'
down_revision: str | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('photo_analyses',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('object_key', sa.String(length=120), nullable=False),
    sa.Column('status', sa.Enum('pending', 'done', 'failed', name='photo_analysis_status'), nullable=False),
    sa.Column('result_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('model', sa.String(length=60), nullable=True),
    sa.Column('error', sa.String(length=40), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_photo_analyses_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_photo_analyses'))
    )
    op.create_index('ix_photo_analyses_user_id_created_at', 'photo_analyses', ['user_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_photo_analyses_user_id_created_at', table_name='photo_analyses')
    op.drop_table('photo_analyses')
    op.execute('DROP TYPE photo_analysis_status')
