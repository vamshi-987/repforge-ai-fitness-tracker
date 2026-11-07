"""Follows, the feed, likes and comments.

The feed is fan-out on read: a query over the people the viewer follows, with no per-follower
copies. `_visible` is the one definition of who may see a workout, and every read here uses it:
- the owner sees everything;
- `private` is nobody else's;
- `followers` needs an accepted follow;
- `public` is anyone's, unless the profile is private: then it also needs an accepted follow.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import ColumnElement, and_, case, delete, exists, func, or_, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, NotFoundError
from app.db.models import (
    Follow,
    FollowStatus,
    SetType,
    User,
    Workout,
    WorkoutComment,
    WorkoutExercise,
    WorkoutLike,
    WorkoutVisibility,
)
from app.schemas.social import (
    CommentIn,
    CommentOut,
    CommentPage,
    FeedExercise,
    FeedPage,
    FeedWorkout,
    FollowOut,
    FollowRequestOut,
    FollowRequests,
    LikeOut,
    Relation,
    UserBrief,
    UserProfileOut,
    UserResult,
    UserSearchOut,
)
from app.services.exercise_search import escape_like
from app.services.profile import field_error
from app.services.push import Notification, Notify
from app.services.workouts import decode_cursor, encode_cursor

SEARCH_LIMIT = 20
COMMENT_PREVIEW_CHARS = 100
MIN_SEARCH_CHARS = 2
FEED_TREE = (
    selectinload(Workout.exercises).selectinload(WorkoutExercise.exercise),
    selectinload(Workout.exercises).selectinload(WorkoutExercise.sets),
)


def _rows(result: Any) -> int:
    """How many rows a write changed; 0 from ON CONFLICT DO NOTHING means nothing is new."""
    count: int = result.rowcount
    return count


def _brief(user: User) -> UserBrief:
    return UserBrief(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
    )


def _follows_owner(viewer_id: uuid.UUID) -> ColumnElement[bool]:
    return exists().where(
        Follow.follower_id == viewer_id,
        Follow.followee_id == Workout.user_id,
        Follow.status == FollowStatus.ACCEPTED,
    )


def _visible(viewer_id: uuid.UUID) -> ColumnElement[bool]:
    """For a query joining Workout to its owner."""
    return and_(
        Workout.deleted_at.is_(None),
        User.deleted_at.is_(None),
        or_(
            Workout.user_id == viewer_id,
            and_(Workout.visibility == WorkoutVisibility.PUBLIC, User.is_private.is_(False)),
            and_(
                Workout.visibility != WorkoutVisibility.PRIVATE,
                _follows_owner(viewer_id),
            ),
        ),
    )


# --- people -----------------------------------------------------------------------------


async def _active_user(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise NotFoundError("User not found")
    return user


async def _relations(
    session: AsyncSession, viewer: User, ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, Relation]:
    rows = await session.execute(
        select(Follow.followee_id, Follow.status).where(
            Follow.follower_id == viewer.id, Follow.followee_id.in_(ids)
        )
    )
    relations = {
        followee: Relation.FOLLOWING if status == FollowStatus.ACCEPTED else Relation.REQUESTED
        for followee, status in rows
    }
    return {i: Relation.SELF if i == viewer.id else relations.get(i, Relation.NONE) for i in ids}


async def search_users(session: AsyncSession, viewer: User, raw_query: str) -> UserSearchOut:
    query = raw_query.strip().lower().lstrip("@")
    if len(query) < MIN_SEARCH_CHARS:
        return UserSearchOut(items=[])
    pattern = escape_like(query)
    prefix = func.lower(User.username).like(f"{pattern}%", escape="\\")
    rows = list(
        await session.scalars(
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.id != viewer.id,
                or_(prefix, User.display_name.ilike(f"%{pattern}%", escape="\\")),
            )
            .order_by(case((prefix, 0), else_=1), User.username)
            .limit(SEARCH_LIMIT)
        )
    )
    relations = await _relations(session, viewer, [u.id for u in rows])
    return UserSearchOut(
        items=[UserResult(**_brief(u).model_dump(), relation=relations[u.id]) for u in rows]
    )


async def _by_username(session: AsyncSession, username: str) -> User:
    user: User | None = await session.scalar(
        select(User).where(func.lower(User.username) == username.lower(), User.deleted_at.is_(None))
    )
    if user is None:
        raise NotFoundError("User not found")
    return user


async def _count_follows(session: AsyncSession, condition: ColumnElement[bool]) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(Follow)
        .where(condition, Follow.status == FollowStatus.ACCEPTED)
    )
    return count or 0


def _can_view(user: User, relation: Relation) -> bool:
    return relation in (Relation.SELF, Relation.FOLLOWING) or not user.is_private


async def get_profile(session: AsyncSession, viewer: User, username: str) -> UserProfileOut:
    user = await _by_username(session, username)
    relation = (await _relations(session, viewer, [user.id]))[user.id]
    return UserProfileOut(
        **_brief(user).model_dump(),
        is_private=user.is_private,
        followers=await _count_follows(session, Follow.followee_id == user.id),
        following=await _count_follows(session, Follow.follower_id == user.id),
        relation=relation,
        can_view_workouts=_can_view(user, relation),
    )


# --- follows ----------------------------------------------------------------------------


async def follow(
    session: AsyncSession, viewer: User, user_id: uuid.UUID, notify: Notify
) -> FollowOut:
    """Follow a public profile, or ask to follow a private one. Doing it twice changes nothing."""
    if user_id == viewer.id:
        raise field_error("user_id", "you can't follow yourself")
    target = await _active_user(session, user_id)
    status = FollowStatus.PENDING if target.is_private else FollowStatus.ACCEPTED
    result = await session.execute(
        insert(Follow)
        .values(follower_id=viewer.id, followee_id=user_id, status=status)
        .on_conflict_do_nothing()
    )
    await session.commit()
    if _rows(result):
        requested = status == FollowStatus.PENDING
        notify(
            Notification(
                user_id=user_id,
                title=viewer.display_name,
                body="wants to follow you" if requested else "started following you",
                path="/social/requests" if requested else f"/social/user/{viewer.username}",
            )
        )
    return FollowOut(relation=(await _relations(session, viewer, [user_id]))[user_id])


async def unfollow(session: AsyncSession, viewer: User, user_id: uuid.UUID) -> None:
    """Stop following, or take back a request."""
    await session.execute(
        delete(Follow).where(Follow.follower_id == viewer.id, Follow.followee_id == user_id)
    )
    await session.commit()


async def follow_requests(session: AsyncSession, viewer: User) -> FollowRequests:
    rows = await session.execute(
        select(User, Follow.created_at)
        .join(Follow, Follow.follower_id == User.id)
        .where(
            Follow.followee_id == viewer.id,
            Follow.status == FollowStatus.PENDING,
            User.deleted_at.is_(None),
        )
        .order_by(Follow.created_at.desc(), User.id)
    )
    return FollowRequests(items=[FollowRequestOut(user=_brief(u), created_at=at) for u, at in rows])


async def accept_request(
    session: AsyncSession, viewer: User, user_id: uuid.UUID, notify: Notify
) -> None:
    row = await session.get(Follow, (user_id, viewer.id))
    if row is None or row.status != FollowStatus.PENDING:
        raise NotFoundError("Follow request not found")
    row.status = FollowStatus.ACCEPTED
    await session.commit()
    notify(
        Notification(
            user_id=user_id,
            title=viewer.display_name,
            body="accepted your follow request",
            path=f"/social/user/{viewer.username}",
        )
    )


async def remove_follower(session: AsyncSession, viewer: User, user_id: uuid.UUID) -> None:
    """Decline a request, or remove someone who already follows."""
    await session.execute(
        delete(Follow).where(Follow.follower_id == user_id, Follow.followee_id == viewer.id)
    )
    await session.commit()


# --- the feed ---------------------------------------------------------------------------


def _feed_exercises(workout: Workout) -> list[FeedExercise]:
    return [
        FeedExercise(
            name=item.exercise.name,
            sets=sum(1 for s in item.sets if s.completed and s.set_type != SetType.WARMUP),
        )
        for item in workout.exercises
    ]


async def _counts(
    session: AsyncSession, column: Any, ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, int]:
    rows = await session.execute(
        select(column, func.count()).where(column.in_(ids)).group_by(column)
    )
    return {workout_id: count for workout_id, count in rows}


async def _feed_items(
    session: AsyncSession, viewer: User, rows: Sequence[Any]
) -> list[FeedWorkout]:
    ids = [workout.id for workout, _ in rows]
    likes = await _counts(session, WorkoutLike.workout_id, ids)
    comments = await _counts(session, WorkoutComment.workout_id, ids)
    liked = set(
        await session.scalars(
            select(WorkoutLike.workout_id).where(
                WorkoutLike.workout_id.in_(ids), WorkoutLike.user_id == viewer.id
            )
        )
    )
    return [
        FeedWorkout(
            id=workout.id,
            user=_brief(owner),
            title=workout.title,
            notes=workout.notes,
            started_at=workout.started_at,
            ended_at=workout.ended_at,
            total_volume_kg=workout.total_volume_kg,
            total_sets=workout.total_sets,
            visibility=workout.visibility,
            exercises=_feed_exercises(workout),
            like_count=likes.get(workout.id, 0),
            comment_count=comments.get(workout.id, 0),
            liked=workout.id in liked,
        )
        for workout, owner in rows
    ]


async def _page(
    session: AsyncSession,
    viewer: User,
    condition: ColumnElement[bool],
    cursor: str | None,
    limit: int,
) -> FeedPage:
    query = (
        select(Workout, User)
        .join(User, User.id == Workout.user_id)
        .where(condition)
        .options(*FEED_TREE)
        .order_by(Workout.started_at.desc(), Workout.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        started_at, workout_id = decode_cursor(cursor)
        query = query.where(tuple_(Workout.started_at, Workout.id) < tuple_(started_at, workout_id))
    rows = (await session.execute(query)).all()
    page = rows[:limit]
    last = page[-1][0] if page else None
    return FeedPage(
        items=await _feed_items(session, viewer, page),
        next_cursor=(
            encode_cursor(last.started_at, last.id) if last and len(rows) > limit else None
        ),
    )


async def feed(session: AsyncSession, viewer: User, cursor: str | None, limit: int) -> FeedPage:
    """The viewer's and their followees' shared workouts, newest first."""
    followed = select(Follow.followee_id).where(
        Follow.follower_id == viewer.id, Follow.status == FollowStatus.ACCEPTED
    )
    condition = and_(
        _visible(viewer.id),
        Workout.visibility != WorkoutVisibility.PRIVATE,
        or_(Workout.user_id == viewer.id, Workout.user_id.in_(followed)),
    )
    return await _page(session, viewer, condition, cursor, limit)


async def user_workouts(
    session: AsyncSession, viewer: User, username: str, cursor: str | None, limit: int
) -> FeedPage:
    owner = await _by_username(session, username)
    relation = (await _relations(session, viewer, [owner.id]))[owner.id]
    if not _can_view(owner, relation):
        raise AppError("profile_private", "This profile is private", 403)
    return await _page(
        session, viewer, and_(_visible(viewer.id), Workout.user_id == owner.id), cursor, limit
    )


async def _visible_workout(
    session: AsyncSession, viewer: User, workout_id: uuid.UUID
) -> tuple[Workout, User]:
    row = (
        await session.execute(
            select(Workout, User)
            .join(User, User.id == Workout.user_id)
            .where(Workout.id == workout_id, _visible(viewer.id))
            .options(*FEED_TREE)
        )
    ).first()
    if row is None:
        raise NotFoundError("Workout not found")
    return row[0], row[1]


async def get_workout(session: AsyncSession, viewer: User, workout_id: uuid.UUID) -> FeedWorkout:
    row = await _visible_workout(session, viewer, workout_id)
    return (await _feed_items(session, viewer, [row]))[0]


# --- likes ------------------------------------------------------------------------------


async def _like_state(session: AsyncSession, viewer: User, workout_id: uuid.UUID) -> LikeOut:
    count = await session.scalar(
        select(func.count()).select_from(WorkoutLike).where(WorkoutLike.workout_id == workout_id)
    )
    mine = await session.get(WorkoutLike, (workout_id, viewer.id))
    return LikeOut(liked=mine is not None, like_count=count or 0)


async def like(
    session: AsyncSession, viewer: User, workout_id: uuid.UUID, notify: Notify
) -> LikeOut:
    workout, _ = await _visible_workout(session, viewer, workout_id)
    owner_id, title = workout.user_id, workout.title
    result = await session.execute(
        insert(WorkoutLike)
        .values(workout_id=workout_id, user_id=viewer.id)
        .on_conflict_do_nothing()
    )
    await session.commit()
    if _rows(result) and owner_id != viewer.id:
        notify(
            Notification(
                user_id=owner_id,
                title=viewer.display_name,
                body=f"liked your workout: {title}",
                path=f"/social/workout/{workout_id}",
            )
        )
    return await _like_state(session, viewer, workout_id)


async def unlike(session: AsyncSession, viewer: User, workout_id: uuid.UUID) -> LikeOut:
    await session.execute(
        delete(WorkoutLike).where(
            WorkoutLike.workout_id == workout_id, WorkoutLike.user_id == viewer.id
        )
    )
    await session.commit()
    return await _like_state(session, viewer, workout_id)


# --- comments ---------------------------------------------------------------------------


def _comment_out(row: WorkoutComment, author: User, workout: Workout, viewer: User) -> CommentOut:
    return CommentOut(
        id=row.id,
        workout_id=row.workout_id,
        user=_brief(author),
        body=row.body,
        created_at=row.created_at,
        can_delete=viewer.id in (row.user_id, workout.user_id),
    )


async def list_comments(
    session: AsyncSession,
    viewer: User,
    workout_id: uuid.UUID,
    cursor: str | None,
    limit: int,
) -> CommentPage:
    """Oldest first."""
    workout, _ = await _visible_workout(session, viewer, workout_id)
    query = (
        select(WorkoutComment, User)
        .join(User, User.id == WorkoutComment.user_id)
        .where(WorkoutComment.workout_id == workout_id, User.deleted_at.is_(None))
        .order_by(WorkoutComment.created_at, WorkoutComment.id)
        .limit(limit + 1)
    )
    if cursor:
        created_at, comment_id = decode_cursor(cursor)
        query = query.where(
            tuple_(WorkoutComment.created_at, WorkoutComment.id) > tuple_(created_at, comment_id)
        )
    rows = (await session.execute(query)).all()
    page = rows[:limit]
    last = page[-1][0] if page else None
    return CommentPage(
        items=[_comment_out(c, u, workout, viewer) for c, u in page],
        next_cursor=(
            encode_cursor(last.created_at, last.id) if last and len(rows) > limit else None
        ),
    )


async def add_comment(
    session: AsyncSession,
    viewer: User,
    workout_id: uuid.UUID,
    body: CommentIn,
    notify: Notify,
) -> CommentOut:
    workout, _ = await _visible_workout(session, viewer, workout_id)
    row = WorkoutComment(workout_id=workout_id, user_id=viewer.id, body=body.body)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    if workout.user_id != viewer.id:
        notify(
            Notification(
                user_id=workout.user_id,
                title=f"{viewer.display_name} commented",
                body=body.body[:COMMENT_PREVIEW_CHARS],
                path=f"/social/workout/{workout_id}",
            )
        )
    return _comment_out(row, viewer, workout, viewer)


async def _comment(
    session: AsyncSession, viewer: User, workout_id: uuid.UUID, comment_id: uuid.UUID
) -> tuple[WorkoutComment, Workout]:
    workout, _ = await _visible_workout(session, viewer, workout_id)
    row = await session.get(WorkoutComment, comment_id)
    if row is None or row.workout_id != workout_id:
        raise NotFoundError("Comment not found")
    return row, workout


async def update_comment(
    session: AsyncSession,
    viewer: User,
    workout_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: CommentIn,
) -> CommentOut:
    """Only its author can reword a comment."""
    row, workout = await _comment(session, viewer, workout_id, comment_id)
    if row.user_id != viewer.id:
        raise AppError("not_comment_author", "Only the author can edit a comment", 403)
    row.body = body.body
    await session.commit()
    return _comment_out(row, viewer, workout, viewer)


async def delete_comment(
    session: AsyncSession, viewer: User, workout_id: uuid.UUID, comment_id: uuid.UUID
) -> None:
    """Its author can, and so can the workout's owner: it's their post."""
    row, workout = await _comment(session, viewer, workout_id, comment_id)
    if viewer.id not in (row.user_id, workout.user_id):
        raise AppError("not_comment_author", "Only the author can delete a comment", 403)
    await session.delete(row)
    await session.commit()
