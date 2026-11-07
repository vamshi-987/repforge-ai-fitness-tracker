from typing import Literal

from pydantic import BaseModel

CheckStatus = Literal["ok", "down"]
OverallStatus = Literal["ok", "degraded"]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str


class ReadinessChecks(BaseModel):
    database: CheckStatus
    redis: CheckStatus


class ReadinessResponse(BaseModel):
    status: OverallStatus
    version: str
    checks: ReadinessChecks
