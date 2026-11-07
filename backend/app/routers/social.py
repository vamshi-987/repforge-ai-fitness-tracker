import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.deps import CurrentUser, DbSession
from app.schemas.social import (
    CommentIn,
    CommentOut,
    CommentPage,
    FeedPage,
    FeedWorkout,
    FollowOut,
    FollowRequests,
    LikeOut,
    UserProfileOut,
    UserSearchOut,
)
from app.services import social
from app.services.push import Notify
from app.workers.tasks.push import enqueue_push

router = APIRouter(tags=["social"])


def get_notify() -> Notify:
    return enqueue_push


NotifyDep = Annotated[Notify, Depends(get_notify)]

Limit = Annotated[int, Query(ge=1, le=50)]
NO_CONTENT = status.HTTP_204_NO_CONTENT


@router.get("/users/search", response_model=UserSearchOut)
async def search_users(
    user: CurrentUser, session: DbSession, q: Annotated[str, Query(max_length=60)] = ""
) -> UserSearchOut:
    return await social.search_users(session, user, q)


@router.get("/users/{username}", response_model=UserProfileOut)
async def get_user(username: str, user: CurrentUser, session: DbSession) -> UserProfileOut:
    return await social.get_profile(session, user, username)


@router.get("/users/{username}/workouts", response_model=FeedPage)
async def user_workouts(
    username: str,
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: Limit = 20,
) -> FeedPage:
    return await social.user_workouts(session, user, username, cursor, limit)


@router.post("/users/{user_id}/follow", response_model=FollowOut)
async def follow(
    user_id: uuid.UUID, user: CurrentUser, session: DbSession, notify: NotifyDep
) -> FollowOut:
    return await social.follow(session, user, user_id, notify)


@router.delete("/users/{user_id}/follow", status_code=NO_CONTENT)
async def unfollow(user_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await social.unfollow(session, user, user_id)


@router.get("/follow-requests", response_model=FollowRequests)
async def follow_requests(user: CurrentUser, session: DbSession) -> FollowRequests:
    return await social.follow_requests(session, user)


@router.post("/follow-requests/{user_id}/accept", status_code=NO_CONTENT)
async def accept_request(
    user_id: uuid.UUID, user: CurrentUser, session: DbSession, notify: NotifyDep
) -> None:
    await social.accept_request(session, user, user_id, notify)


@router.delete("/followers/{user_id}", status_code=NO_CONTENT)
async def remove_follower(user_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    """Decline a follow request, or remove a follower."""
    await social.remove_follower(session, user, user_id)


@router.get("/feed", response_model=FeedPage)
async def feed(
    user: CurrentUser, session: DbSession, cursor: str | None = None, limit: Limit = 20
) -> FeedPage:
    return await social.feed(session, user, cursor, limit)


@router.get("/feed/workouts/{workout_id}", response_model=FeedWorkout)
async def feed_workout(workout_id: uuid.UUID, user: CurrentUser, session: DbSession) -> FeedWorkout:
    return await social.get_workout(session, user, workout_id)


@router.post("/workouts/{workout_id}/like", response_model=LikeOut)
async def like(
    workout_id: uuid.UUID, user: CurrentUser, session: DbSession, notify: NotifyDep
) -> LikeOut:
    return await social.like(session, user, workout_id, notify)


@router.delete("/workouts/{workout_id}/like", response_model=LikeOut)
async def unlike(workout_id: uuid.UUID, user: CurrentUser, session: DbSession) -> LikeOut:
    return await social.unlike(session, user, workout_id)


@router.get("/workouts/{workout_id}/comments", response_model=CommentPage)
async def list_comments(
    workout_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: Limit = 50,
) -> CommentPage:
    return await social.list_comments(session, user, workout_id, cursor, limit)


@router.post(
    "/workouts/{workout_id}/comments",
    response_model=CommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_comment(
    workout_id: uuid.UUID,
    body: CommentIn,
    user: CurrentUser,
    session: DbSession,
    notify: NotifyDep,
) -> CommentOut:
    return await social.add_comment(session, user, workout_id, body, notify)


@router.patch("/workouts/{workout_id}/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    workout_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: CommentIn,
    user: CurrentUser,
    session: DbSession,
) -> CommentOut:
    return await social.update_comment(session, user, workout_id, comment_id, body)


@router.delete("/workouts/{workout_id}/comments/{comment_id}", status_code=NO_CONTENT)
async def delete_comment(
    workout_id: uuid.UUID, comment_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> None:
    await social.delete_comment(session, user, workout_id, comment_id)
