import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.workers.tasks.system import ping

pytestmark = pytest.mark.integration


async def test_readiness_is_ok_against_real_services(client: AsyncClient) -> None:
    response = await client.get("/v1/health/ready")

    assert response.status_code == 200
    assert response.json()["checks"] == {"database": "ok", "redis": "ok"}


async def test_migrations_enable_pg_trgm(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'")
        )

    assert result.scalar_one() == "pg_trgm"


def test_celery_worker_answers_ping() -> None:
    assert ping.delay().get(timeout=15) == "pong"
