from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import CurrentUser, DbSession, RedisClient, SettingsDep
from app.schemas.sync import DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT, SyncPullOut, SyncPush, SyncPushOut
from app.services import sync as sync_service
from app.services.routines import routine_limit

router = APIRouter(tags=["sync"])


@router.post("/sync/push", response_model=SyncPushOut)
async def push(
    body: SyncPush,
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
    settings: SettingsDep,
) -> SyncPushOut:
    return await sync_service.push(
        session,
        redis,
        user,
        body,
        routine_limit=routine_limit(user, settings),
        now=datetime.now(UTC),
    )


@router.get("/sync/pull", response_model=SyncPullOut)
async def pull(
    user: CurrentUser,
    session: DbSession,
    since: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=MAX_PULL_LIMIT)] = DEFAULT_PULL_LIMIT,
) -> SyncPullOut:
    return await sync_service.pull(session, user, since=since, limit=limit)
