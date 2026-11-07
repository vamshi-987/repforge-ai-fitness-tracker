"""Load the exercise library and the starter food library: `python -m app.commands.seed`.

Safe to run any number of times; only rows whose seed data changed are rewritten.
"""

import asyncio
import sys
from pathlib import Path

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.cache.redis import close_redis, get_redis_client
from app.config import get_settings
from app.core.logging import configure_logging
from app.db.session import dispose_engine, get_sessionmaker
from app.services.exercises import bust_library_cache
from app.services.food_library import ImportReport, apply_seed
from app.services.library_seed import (
    DEFAULT_SEEDS_DIR,
    SeedError,
    SeedReport,
    apply_library,
    load_library,
)


async def run(
    sessions: async_sessionmaker[AsyncSession],
    redis: Redis,
    seeds_dir: Path = DEFAULT_SEEDS_DIR,
) -> tuple[SeedReport, ImportReport]:
    library = load_library(seeds_dir)
    async with sessions() as session:
        report = await apply_library(session, library)
    if report.changed:
        # New library version: API caches and client ETags for the old one stop matching.
        await bust_library_cache(redis)
    async with sessions() as session:
        foods = await apply_seed(session, seeds_dir)
    return report, foods


async def _main() -> tuple[SeedReport, ImportReport]:
    try:
        return await run(get_sessionmaker(), get_redis_client())
    finally:
        await dispose_engine()
        await close_redis()


def main() -> int:
    configure_logging(get_settings().log_level)
    try:
        report, foods = asyncio.run(_main())
    except SeedError as exc:
        print(f"seed refused: {exc}", file=sys.stderr)
        return 1
    print(report.summary())
    print(foods.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
