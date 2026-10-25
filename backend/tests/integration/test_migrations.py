import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.models import Base

pytestmark = pytest.mark.integration


async def test_migrations_match_the_models(engine: AsyncEngine) -> None:
    """Fails when a model changes without a matching Alembic migration (or vice versa)."""

    def diff(connection: Connection) -> list[object]:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        return list(compare_metadata(context, Base.metadata))

    async with engine.connect() as conn:
        differences = await conn.run_sync(diff)

    assert differences == []
