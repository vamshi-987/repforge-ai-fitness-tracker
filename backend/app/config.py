from functools import lru_cache
from typing import Literal, Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Only for local development; `environment=prod` refuses to start with it.
DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me"


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (and `.env` in dev)."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "RepForge API"
    app_version: str = "0.1.0"
    environment: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://repforge:repforge@localhost:5432/repforge"
    # Integration tests migrate and use this database instead of DATABASE_URL.
    test_database_url: str | None = None
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    cors_origins: list[str] = []

    # Seconds a single readiness check may take before it counts as down.
    health_check_timeout_s: float = 2.0

    # --- Auth ---------------------------------------------------------------
    jwt_secret: str = DEV_JWT_SECRET
    jwt_issuer: str = "repforge"
    access_token_ttl_s: int = 15 * 60
    refresh_token_ttl_s: int = 30 * 24 * 3600
    # Sliding window per client IP, shared by login, register and social sign-in.
    login_rate_limit: int = 10
    login_rate_window_s: int = 15 * 60
    # OAuth audiences (JSON lists). An empty list disables that provider (503).
    google_client_ids: list[str] = []
    apple_client_ids: list[str] = []
    jwks_cache_ttl_s: int = 12 * 3600

    @model_validator(mode="after")
    def _require_real_secret_in_prod(self) -> Self:
        if self.environment == "prod" and (
            self.jwt_secret == DEV_JWT_SECRET or len(self.jwt_secret) < 32
        ):
            raise ValueError("JWT_SECRET must be set to a random value of 32+ characters in prod")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
