from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.deps import CurrentUser, DbSession
from app.schemas.push import PushTokenIn
from app.services import push

router = APIRouter(tags=["push"])

NO_CONTENT = status.HTTP_204_NO_CONTENT


@router.post("/push/tokens", status_code=NO_CONTENT)
async def register_token(body: PushTokenIn, user: CurrentUser, session: DbSession) -> None:
    await push.register_token(session, user, body, datetime.now(UTC))


@router.delete("/push/tokens", status_code=NO_CONTENT)
async def remove_token(
    token: Annotated[str, Query(max_length=200)], user: CurrentUser, session: DbSession
) -> None:
    """On sign-out, so the next person on this phone doesn't get these pushes."""
    await push.remove_token(session, user, token)
