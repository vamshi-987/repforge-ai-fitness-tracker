from collections.abc import Callable

import pytest
from httpx import AsyncClient


async def test_liveness_returns_ok_and_version(client: AsyncClient) -> None:
    response = await client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


async def test_liveness_sets_request_id(client: AsyncClient) -> None:
    response = await client.get("/v1/health")

    assert len(response.headers["x-request-id"]) == 32


async def test_valid_client_request_id_is_echoed(client: AsyncClient) -> None:
    response = await client.get("/v1/health", headers={"X-Request-ID": "mobile-abc.123"})

    assert response.headers["x-request-id"] == "mobile-abc.123"


async def test_unsafe_client_request_id_is_replaced(client: AsyncClient) -> None:
    response = await client.get("/v1/health", headers={"X-Request-ID": "bad id\twith spaces"})

    assert response.headers["x-request-id"] != "bad id\twith spaces"
    assert len(response.headers["x-request-id"]) == 32


@pytest.mark.parametrize(
    ("db_fail", "redis_fail", "status_code", "overall", "database", "redis"),
    [
        (False, False, 200, "ok", "ok", "ok"),
        (True, False, 503, "degraded", "down", "ok"),
        (False, True, 503, "degraded", "ok", "down"),
        (True, True, 503, "degraded", "down", "down"),
    ],
)
async def test_readiness_reports_each_dependency(
    client: AsyncClient,
    override_deps: Callable[..., None],
    db_fail: bool,
    redis_fail: bool,
    status_code: int,
    overall: str,
    database: str,
    redis: str,
) -> None:
    override_deps(db_fail=db_fail, redis_fail=redis_fail)

    response = await client.get("/v1/health/ready")

    assert response.status_code == status_code
    assert response.json() == {
        "status": overall,
        "version": "0.1.0",
        "checks": {"database": database, "redis": redis},
    }
