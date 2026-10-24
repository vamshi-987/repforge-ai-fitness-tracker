"""Integration fixtures: real Postgres (TEST_DATABASE_URL) and Redis from docker-compose."""

import os
from collections.abc import AsyncIterator, Iterator

import pytest
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from alembic import command
from app.cache.redis import close_redis
from app.config import get_settings
from app.db.session import dispose_engine

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))


@pytest.fixture(scope="session", autouse=True)
def migrated_test_database() -> Iterator[str]:
    """Point the app at the test database and migrate it to head once per session."""
    test_url = get_settings().test_database_url
    if not test_url:
        pytest.skip("TEST_DATABASE_URL is not set; run `make up` and copy .env.example to .env")

    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = test_url
    get_settings.cache_clear()

    config = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    command.upgrade(config, "head")

    yield test_url

    if previous is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = previous
    get_settings.cache_clear()


@pytest.fixture
async def engine(migrated_test_database: str) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(migrated_test_database)
    yield eng
    await eng.dispose()


@pytest.fixture(autouse=True)
async def release_shared_clients() -> AsyncIterator[None]:
    """Close pooled clients after each test so none outlive the event loop."""
    yield
    await dispose_engine()
    await close_redis()
