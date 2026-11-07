"""Import a food composition table from a local CSV: `python -m app.commands.import_foods
--source ifct path/to/foods.csv`.

For tables whose licence doesn't allow redistribution. The Indian Food Composition Tables
(IFCT 2017) are copyrighted by the National Institute of Nutrition (ICMR), so RepForge ships no
IFCT values: anyone with permission converts the table to this CSV layout and imports it into
their own database. Keep such files out of git (`backend/seeds/private/` is ignored).

Columns: external_id, name, kcal_100g, protein_100g, carbs_100g, fat_100g, and optionally
fiber_100g, serving_label, serving_grams. Re-importing updates rows in place.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import FoodSource
from app.db.session import dispose_engine, get_sessionmaker
from app.services.food_library import CsvError, ImportReport, read_csv, upsert_foods


async def run(
    sessions: async_sessionmaker[AsyncSession], source: FoodSource, path: Path
) -> ImportReport:
    foods = read_csv(path)
    async with sessions() as session:
        report, _ = await upsert_foods(session, source, foods)
        await session.commit()
    return report


async def _main(source: FoodSource, path: Path) -> ImportReport:
    try:
        return await run(get_sessionmaker(), source, path)
    finally:
        await dispose_engine()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--source", choices=[FoodSource.IFCT.value, FoodSource.USDA.value], required=True
    )
    parser.add_argument("csv", type=Path)
    args = parser.parse_args(argv)
    try:
        report = asyncio.run(_main(FoodSource(args.source), args.csv))
    except (CsvError, FileNotFoundError) as exc:
        print(f"import refused: {exc}", file=sys.stderr)
        return 1
    print(report.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
