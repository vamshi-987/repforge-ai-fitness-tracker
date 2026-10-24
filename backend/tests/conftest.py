import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("LOG_LEVEL", "WARNING")

from collections.abc import AsyncIterator, Callable

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.cache.redis import get_redis
from app.db.session import get_db
from app.main import create_app


class FakeSession:
    """Stands in for AsyncSession in unit tests; `fail` makes every execute raise."""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    async def execute(self, *_: object, **__: object) -> None:
        if self.fail:
            raise ConnectionError("database unavailable")


class FakeRedis:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    async def ping(self) -> bool:
        if self.fail:
            raise ConnectionError("redis unavailable")
        return True


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
def override_deps(app: FastAPI) -> Callable[..., None]:
    """Swap the DB session and Redis client for fakes: `override_deps(db_fail=True)`."""

    def _apply(db_fail: bool = False, redis_fail: bool = False) -> None:
        async def fake_db() -> AsyncIterator[FakeSession]:
            yield FakeSession(fail=db_fail)

        async def fake_redis() -> FakeRedis:
            return FakeRedis(fail=redis_fail)

        app.dependency_overrides[get_db] = fake_db
        app.dependency_overrides[get_redis] = fake_redis

    return _apply


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
