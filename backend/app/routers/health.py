from fastapi import APIRouter, Response, status

from app.deps import DbSession, RedisClient, SettingsDep
from app.schemas.health import HealthResponse, ReadinessResponse
from app.services import health as health_service

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", response_model=HealthResponse)
async def liveness(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(version=settings.app_version)


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse}},
)
async def readiness(
    response: Response,
    session: DbSession,
    redis: RedisClient,
    settings: SettingsDep,
) -> ReadinessResponse:
    overall, checks = await health_service.readiness(
        session, redis, settings.health_check_timeout_s
    )
    if overall != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(status=overall, version=settings.app_version, checks=checks)
