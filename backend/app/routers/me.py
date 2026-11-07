from datetime import UTC, datetime

from fastapi import APIRouter

from app.deps import CurrentUser, DbSession
from app.schemas.me import MeOut, MeUpdate, ProfileOut, ProfileUpdate, SettingsOut, SettingsUpdate
from app.services import profile as profile_service

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeOut)
async def get_me(user: CurrentUser, session: DbSession) -> MeOut:
    return await profile_service.get_me(session, user)


@router.patch("", response_model=MeOut)
async def update_me(body: MeUpdate, user: CurrentUser, session: DbSession) -> MeOut:
    return await profile_service.update_me(session, user, body)


@router.patch("/profile", response_model=ProfileOut)
async def update_profile(body: ProfileUpdate, user: CurrentUser, session: DbSession) -> ProfileOut:
    return await profile_service.update_profile(session, user, body, datetime.now(UTC))


@router.get("/settings", response_model=SettingsOut)
async def get_settings(user: CurrentUser, session: DbSession) -> SettingsOut:
    return await profile_service.get_settings_out(session, user)


@router.patch("/settings", response_model=SettingsOut)
async def update_settings(
    body: SettingsUpdate, user: CurrentUser, session: DbSession
) -> SettingsOut:
    return await profile_service.update_settings(session, user, body)
