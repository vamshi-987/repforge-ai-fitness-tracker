import hmac
from typing import Annotated

from fastapi import APIRouter, Header, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import Settings
from app.core.errors import AuthError, NotFoundError
from app.deps import SettingsDep

router = APIRouter(tags=["metrics"], include_in_schema=False)


def check_access(settings: Settings, authorization: str | None) -> None:
    token = settings.metrics_token
    if not token:
        if settings.environment == "prod":
            raise NotFoundError("Not found")
        return
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise AuthError("invalid_metrics_token", "Wrong metrics token")


@router.get("/metrics")
async def metrics(
    settings: SettingsDep, authorization: Annotated[str | None, Header()] = None
) -> Response:
    check_access(settings, authorization)
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
