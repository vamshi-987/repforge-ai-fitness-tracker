"""Integration fixtures: real Postgres (TEST_DATABASE_URL) and Redis from docker-compose."""

import os
from collections.abc import AsyncIterator, Iterator

import pytest
from alembic.config import Config
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from alembic import command
from app.cache.redis import close_redis, get_redis
from app.config import Settings, get_settings
from app.db.session import dispose_engine, get_db
from app.deps import get_jwks_fetcher
from tests.oauth_helpers import APPLE_AUDIENCE, GOOGLE_AUDIENCE, FakeJwksFetcher, RsaSigner

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


@pytest.fixture
async def db_connection(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    """One connection per test inside a transaction that is always rolled back."""
    async with engine.connect() as conn:
        transaction = await conn.begin()
        yield conn
        await transaction.rollback()


@pytest.fixture
def session_factory(db_connection: AsyncConnection) -> async_sessionmaker[AsyncSession]:
    # Each session runs in a SAVEPOINT, so service code can commit() as in production
    # while the outer transaction still discards everything when the test ends.
    return async_sessionmaker(
        bind=db_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )


@pytest.fixture
async def fake_redis() -> AsyncIterator[FakeAsyncRedis]:
    client = FakeAsyncRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest.fixture
def test_settings(migrated_test_database: str) -> Settings:
    return Settings(
        environment="test",
        database_url=migrated_test_database,
        google_client_ids=[GOOGLE_AUDIENCE],
        apple_client_ids=[APPLE_AUDIENCE],
        login_rate_limit=100,
    )


@pytest.fixture(scope="session")
def oauth_signer() -> RsaSigner:
    return RsaSigner()


@pytest.fixture
def jwks_fetcher(oauth_signer: RsaSigner) -> FakeJwksFetcher:
    return FakeJwksFetcher(oauth_signer)


@pytest.fixture
async def api_client(
    app: FastAPI,
    session_factory: async_sessionmaker[AsyncSession],
    fake_redis: FakeAsyncRedis,
    test_settings: Settings,
    jwks_fetcher: FakeJwksFetcher,
) -> AsyncIterator[AsyncClient]:
    """HTTP client for an app wired to the rolled-back test transaction and fake Redis."""

    async def _db() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    async def _redis() -> FakeAsyncRedis:
        return fake_redis

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_redis] = _redis
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_jwks_fetcher] = lambda: jwks_fetcher

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
