from fastapi import FastAPI, Query
from httpx import AsyncClient

from app.core.errors import AppError, NotFoundError


def _add_error_routes(app: FastAPI) -> None:
    @app.get("/_test/app-error")
    async def raise_app_error() -> None:
        raise AppError("routine_limit", "Free plan allows 4 routines", 403, {"limit": 4})

    @app.get("/_test/not-found")
    async def raise_not_found() -> None:
        raise NotFoundError("Workout not found")

    @app.get("/_test/validated")
    async def validated(limit: int = Query(ge=1, le=100)) -> dict[str, int]:
        return {"limit": limit}

    @app.get("/_test/boom")
    async def boom() -> None:
        raise RuntimeError("unexpected")


async def test_app_error_renders_envelope(app: FastAPI, client: AsyncClient) -> None:
    _add_error_routes(app)

    response = await client.get("/_test/app-error")

    assert response.status_code == 403
    assert response.json() == {
        "error": {
            "code": "routine_limit",
            "message": "Free plan allows 4 routines",
            "details": {"limit": 4},
        }
    }


async def test_not_found_error(app: FastAPI, client: AsyncClient) -> None:
    _add_error_routes(app)

    response = await client.get("/_test/not-found")

    assert response.status_code == 404
    assert response.json()["error"] == {
        "code": "not_found",
        "message": "Workout not found",
        "details": None,
    }


async def test_unknown_route_uses_envelope(client: AsyncClient) -> None:
    response = await client.get("/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def test_method_not_allowed_uses_envelope(client: AsyncClient) -> None:
    response = await client.post("/v1/health")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


async def test_validation_error_lists_fields(app: FastAPI, client: AsyncClient) -> None:
    _add_error_routes(app)

    response = await client.get("/_test/validated", params={"limit": 0})

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert body["details"][0]["loc"] == ["query", "limit"]


async def test_unhandled_exception_is_hidden(app: FastAPI, client: AsyncClient) -> None:
    _add_error_routes(app)

    response = await client.get("/_test/boom")

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Something went wrong", "details": None}
    }
