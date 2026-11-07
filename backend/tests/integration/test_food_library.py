from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.commands import import_foods
from app.db.models import Food, FoodSource
from app.services.food_library import (
    CsvError,
    LibraryFood,
    Serving,
    apply_seed,
    library_food_id,
    load_seed,
    read_csv,
    upsert_foods,
)

pytestmark = pytest.mark.integration

Sessions = async_sessionmaker[AsyncSession]


async def food(session: AsyncSession, source: FoodSource, external_id: str) -> Food:
    row = await session.scalar(
        select(Food)
        .where(Food.id == library_food_id(source, external_id))
        .options(selectinload(Food.servings))
        .execution_options(populate_existing=True)
    )
    assert row is not None
    return row


def test_the_seed_is_usda_data_with_ids() -> None:
    foods = load_seed()

    assert len(foods) >= 50
    by_name = {f.name: f for f in foods}
    roti = by_name["Roti / chapati"]
    assert (roti.external_id, roti.kcal_100g, roti.protein_100g) == ("171844", 297.0, 11.25)
    assert by_name["Egg, whole, raw"].servings[0] == Serving("1 large", 50.0)
    # Every name is unique and every food has the four main values.
    assert len(by_name) == len(foods)
    assert all(f.kcal_100g >= 0 and f.protein_100g >= 0 for f in foods)


async def test_applying_the_seed_twice_changes_nothing(session_factory: Sessions) -> None:
    async with session_factory() as session:
        first = await apply_seed(session)
        second = await apply_seed(session)
        rice = await food(session, FoodSource.USDA, "168878")

    assert first.inserted + first.updated + first.unchanged == len(load_seed())
    assert (second.inserted, second.updated) == (0, 0)
    assert (rice.name, rice.kcal_100g, rice.owner_user_id) == ("White rice, cooked", 130.0, None)
    assert [(s.label, s.grams) for s in rice.servings] == [("1 cup", 158.0)]


async def test_an_upsert_updates_values_and_servings_in_place(session_factory: Sessions) -> None:
    item = LibraryFood("x1", "Test Dal", 100, 6, 15, 2, 4, servings=(Serving("1 bowl", 150),))
    async with session_factory() as session:
        await upsert_foods(session, FoodSource.IFCT, [item])
        before = await food(session, FoodSource.IFCT, "x1")
        version = before.version

        changed = LibraryFood(
            "x1", "Test Dal", 104.004, 6, 15, 2, None, servings=(Serving("1 katori", 120),)
        )
        report, _ = await upsert_foods(session, FoodSource.IFCT, [changed])
        after = await food(session, FoodSource.IFCT, "x1")

        same, _ = await upsert_foods(session, FoodSource.IFCT, [changed])

    assert (report.updated, same.unchanged) == (1, 1)
    assert after.version == version + 1
    assert (after.kcal_100g, after.fiber_100g) == (104.0, None)
    assert [(s.label, s.grams) for s in after.servings] == [("1 katori", 120.0)]


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "foods.csv"
    path.write_text(text)
    return path


def test_csv_rows_become_foods(tmp_path: Path) -> None:
    path = write(
        tmp_path,
        "external_id,name,kcal_100g,protein_100g,carbs_100g,fat_100g,fiber_100g,serving_label,serving_grams\n"
        "A001,Rice flakes (poha),346,6.6,77.3,1.2,,1 cup,90\n"
        "A002,Sambar,60,3,8,2,1.5,,\n",
    )

    foods = read_csv(path)

    assert foods[0] == LibraryFood(
        "A001", "Rice flakes (poha)", 346, 6.6, 77.3, 1.2, None, servings=(Serving("1 cup", 90),)
    )
    assert foods[1].servings == () and foods[1].fiber_100g == 1.5


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("external_id,name\nA,B\n", "missing columns"),
        ("external_id,name,kcal_100g,protein_100g,carbs_100g,fat_100g\nA,B,x,1,1,1\n", "line 2"),
        ("external_id,name,kcal_100g,protein_100g,carbs_100g,fat_100g\n,B,1,1,1,1\n", "required"),
    ],
)
def test_bad_csv_is_refused(tmp_path: Path, text: str, problem: str) -> None:
    with pytest.raises(CsvError, match=problem):
        read_csv(write(tmp_path, text))


async def test_the_import_command(session_factory: Sessions, tmp_path: Path) -> None:
    path = write(
        tmp_path,
        "external_id,name,kcal_100g,protein_100g,carbs_100g,fat_100g\nI1,Upma (test),120,3,18,4\n",
    )

    report = await import_foods.run(session_factory, FoodSource.IFCT, path)
    async with session_factory() as session:
        count = await session.scalar(
            select(func.count()).select_from(Food).where(Food.source == FoodSource.IFCT)
        )

    assert report.inserted == 1 and count == 1


def test_the_import_command_refuses_a_missing_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert import_foods.main(["--source", "ifct", str(tmp_path / "missing.csv")]) == 1
    assert "import refused" in capsys.readouterr().err
