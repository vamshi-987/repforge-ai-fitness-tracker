from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, status

from app.deps import DbSession, SettingsDep
from app.schemas.billing import RevenueCatWebhook
from app.services import billing

router = APIRouter(tags=["billing"])


@router.post("/webhooks/revenuecat", status_code=status.HTTP_204_NO_CONTENT)
async def revenuecat_webhook(
    body: RevenueCatWebhook,
    session: DbSession,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    billing.check_secret(settings, authorization)
    await billing.handle_event(session, settings, body.event, datetime.now(UTC))
