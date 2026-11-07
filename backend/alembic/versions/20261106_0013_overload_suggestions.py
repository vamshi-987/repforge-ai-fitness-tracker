"""overload suggestions

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-06 13:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0013'
down_revision: str | None = '0012'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('overload_suggestions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('exercise_id', sa.Uuid(), nullable=False),
    sa.Column('generated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('rule', sa.Enum('increase_weight', 'add_reps', 'reduce_weight', 'deload', 'swap', name='overload_rule'), nullable=False),
    sa.Column('target_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('explanation', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['exercise_id'], ['exercises.id'], name=op.f('fk_overload_suggestions_exercise_id_exercises'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_overload_suggestions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_overload_suggestions'))
    )
    op.create_index('ix_overload_suggestions_user_id_exercise_id_generated_at', 'overload_suggestions', ['user_id', 'exercise_id', 'generated_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_overload_suggestions_user_id_exercise_id_generated_at', table_name='overload_suggestions')
    op.drop_table('overload_suggestions')
    op.execute('DROP TYPE overload_rule')
