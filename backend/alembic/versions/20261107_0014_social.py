"""social: follows, likes and comments

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-07 12:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0014'
down_revision: str | None = '0013'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('follows',
    sa.Column('follower_id', sa.Uuid(), nullable=False),
    sa.Column('followee_id', sa.Uuid(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'accepted', name='follow_status'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('follower_id <> followee_id', name=op.f('ck_follows_not_self')),
    sa.ForeignKeyConstraint(['followee_id'], ['users.id'], name=op.f('fk_follows_followee_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['follower_id'], ['users.id'], name=op.f('fk_follows_follower_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('follower_id', 'followee_id', name=op.f('pk_follows'))
    )
    op.create_index('ix_follows_followee_id_status', 'follows', ['followee_id', 'status'], unique=False)
    op.create_table('workout_likes',
    sa.Column('workout_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_workout_likes_user_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workout_id'], ['workouts.id'], name=op.f('fk_workout_likes_workout_id_workouts'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('workout_id', 'user_id', name=op.f('pk_workout_likes'))
    )
    op.create_table('workout_comments',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('workout_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_workout_comments_user_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workout_id'], ['workouts.id'], name=op.f('fk_workout_comments_workout_id_workouts'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_workout_comments'))
    )
    op.create_index('ix_workout_comments_workout_id_created_at', 'workout_comments', ['workout_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_workout_comments_workout_id_created_at', table_name='workout_comments')
    op.drop_table('workout_comments')
    op.drop_table('workout_likes')
    op.drop_index('ix_follows_followee_id_status', table_name='follows')
    op.drop_table('follows')
    op.execute('DROP TYPE follow_status')
