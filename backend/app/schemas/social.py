import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from app.db.models import WorkoutVisibility


class Relation(StrEnum):
    """Where the viewer stands with a user."""

    SELF = "self"
    NONE = "none"
    REQUESTED = "requested"
    FOLLOWING = "following"


class UserBrief(BaseModel):
    """Everything other people may see of a user anywhere. Never an email."""

    id: uuid.UUID
    username: str
    display_name: str
    avatar_url: str | None


class UserResult(UserBrief):
    relation: Relation


class UserSearchOut(BaseModel):
    items: list[UserResult]


class UserProfileOut(UserBrief):
    is_private: bool
    followers: int
    following: int
    relation: Relation
    # False on a private profile the viewer doesn't follow.
    can_view_workouts: bool


class FollowOut(BaseModel):
    relation: Relation


class FollowRequestOut(BaseModel):
    user: UserBrief
    created_at: datetime


class FollowRequests(BaseModel):
    items: list[FollowRequestOut]


class FeedExercise(BaseModel):
    name: str
    sets: int


class FeedWorkout(BaseModel):
    id: uuid.UUID
    user: UserBrief
    title: str
    notes: str
    started_at: datetime
    ended_at: datetime
    total_volume_kg: float
    total_sets: int
    visibility: WorkoutVisibility
    exercises: list[FeedExercise]
    like_count: int
    comment_count: int
    liked: bool


class FeedPage(BaseModel):
    items: list[FeedWorkout]
    next_cursor: str | None


class LikeOut(BaseModel):
    liked: bool
    like_count: int


def _collapse_spaces(value: object) -> object:
    return " ".join(value.split()) if isinstance(value, str) else value


CommentText = Annotated[str, BeforeValidator(_collapse_spaces), Field(min_length=1, max_length=500)]


class CommentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: CommentText


class CommentOut(BaseModel):
    id: uuid.UUID
    workout_id: uuid.UUID
    user: UserBrief
    body: str
    created_at: datetime
    # The author, or the workout's owner.
    can_delete: bool


class CommentPage(BaseModel):
    items: list[CommentOut]
    next_cursor: str | None
