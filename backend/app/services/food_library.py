"""The shared food library: foods from the seed, from a locally imported table, and those
cached from USDA FoodData Central / Open Food Facts when someone searches or scans them.

Library foods have no owner. Their ids are UUIDv5 of `source:external_id`, so the same food
gets the same id on every machine and a re-import updates it in place. Only rows whose values
changed are rewritten, so `version`/`change_seq` move only on real changes.
"""

import csv
import json
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Food, FoodServing, FoodSource
from app.services.library_seed import DEFAULT_SEEDS_DIR
from app.services.profile import round_half_up

FOOD_NAMESPACE = uuid.UUID("0f6f8f1e-3d4a-4c6b-9a57-2f1c7a9d5e10")
NAME_MAX = 200
BRAND_MAX = 120


def library_food_id(source: FoodSource, external_id: str) -> uuid.UUID:
    return uuid.uuid5(FOOD_NAMESPACE, f"{source.value}:{external_id}")


@dataclass(frozen=True)
class Serving:
    label: str
    grams: float


@dataclass(frozen=True)
class LibraryFood:
    """A food as a source describes it, normalised to per-100 g values."""

    external_id: str
    name: str
    kcal_100g: float
    protein_100g: float
    carbs_100g: float
    fat_100g: float
    fiber_100g: float | None = None
    brand: str | None = None
    barcode: str | None = None
    servings: tuple[Serving, ...] = field(default_factory=tuple)


def _fields(food: LibraryFood) -> dict[str, Any]:
    def nutrient(value: float | None) -> float | None:
        return None if value is None else round_half_up(max(0.0, value), 2)

    return {
        "name": food.name.strip()[:NAME_MAX],
        "brand": food.brand.strip()[:BRAND_MAX] if food.brand else None,
        "barcode": food.barcode,
        "kcal_100g": nutrient(food.kcal_100g),
        "protein_100g": nutrient(food.protein_100g),
        "carbs_100g": nutrient(food.carbs_100g),
        "fat_100g": nutrient(food.fat_100g),
        "fiber_100g": nutrient(food.fiber_100g),
    }


def _servings(food: LibraryFood) -> list[tuple[str, float]]:
    return [(s.label.strip()[:80], round_half_up(s.grams, 2)) for s in food.servings if s.grams > 0]


@dataclass
class ImportReport:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0

    def summary(self) -> str:
        return f"foods: {self.inserted} new, {self.updated} updated, {self.unchanged} unchanged"


async def upsert_foods(
    session: AsyncSession, source: FoodSource, foods: Iterable[LibraryFood]
) -> tuple[ImportReport, list[Food]]:
    """Insert or update library foods (no commit). Returns the report and the rows."""
    items = list(foods)
    ids = {library_food_id(source, f.external_id): f for f in items}
    existing = {
        row.id: row
        for row in await session.scalars(
            select(Food).where(Food.id.in_(ids)).options(selectinload(Food.servings))
        )
    }
    report = ImportReport()
    rows: list[Food] = []
    for food_id, food in ids.items():
        values = _fields(food)
        servings = _servings(food)
        row = existing.get(food_id)
        if row is None:
            row = Food(
                id=food_id,
                owner_user_id=None,
                source=source,
                external_id=food.external_id,
                servings=[
                    FoodServing(position=i, label=label, grams=grams)
                    for i, (label, grams) in enumerate(servings)
                ],
                **values,
            )
            session.add(row)
            report.inserted += 1
        else:
            changed = any(getattr(row, k) != v for k, v in values.items())
            old_servings = [(s.label, s.grams) for s in row.servings]
            if old_servings != servings:
                row.servings.clear()
                row.servings.extend(
                    FoodServing(position=i, label=label, grams=grams)
                    for i, (label, grams) in enumerate(servings)
                )
                changed = True
            if changed:
                for key, value in values.items():
                    setattr(row, key, value)
                row.version += 1
                report.updated += 1
            else:
                report.unchanged += 1
        rows.append(row)
    await session.flush()
    return report, rows


# --- the bundled seed (USDA FoodData Central, public domain) ---------------------------


def load_seed(seeds_dir: Path = DEFAULT_SEEDS_DIR) -> list[LibraryFood]:
    """`seeds/foods.json`, built by `scripts/build_usda_foods.py`."""
    raw: Sequence[dict[str, Any]] = json.loads((seeds_dir / "foods.json").read_text())
    return [
        LibraryFood(
            external_id=str(item["fdc_id"]),
            name=item["name"],
            kcal_100g=item["kcal_100g"],
            protein_100g=item["protein_100g"],
            carbs_100g=item["carbs_100g"],
            fat_100g=item["fat_100g"],
            fiber_100g=item.get("fiber_100g"),
            servings=tuple(Serving(s["label"], s["grams"]) for s in item.get("servings", [])),
        )
        for item in raw
    ]


async def apply_seed(session: AsyncSession, seeds_dir: Path = DEFAULT_SEEDS_DIR) -> ImportReport:
    report, _ = await upsert_foods(session, FoodSource.USDA, load_seed(seeds_dir))
    await session.commit()
    return report


# --- a locally licensed table (e.g. IFCT), never committed ------------------------------

CSV_COLUMNS = (
    "external_id",
    "name",
    "kcal_100g",
    "protein_100g",
    "carbs_100g",
    "fat_100g",
    "fiber_100g",
    "serving_label",
    "serving_grams",
)


class CsvError(ValueError):
    pass


def read_csv(path: Path) -> list[LibraryFood]:
    """Rows of CSV_COLUMNS (fiber and the serving are optional)."""
    foods: list[LibraryFood] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = [c for c in CSV_COLUMNS[:6] if c not in (reader.fieldnames or [])]
        if missing:
            raise CsvError(f"missing columns: {', '.join(missing)}")
        for line, row in enumerate(reader, start=2):
            try:
                serving = (
                    (Serving(row["serving_label"], float(row["serving_grams"])),)
                    if row.get("serving_label") and row.get("serving_grams")
                    else ()
                )
                foods.append(
                    LibraryFood(
                        external_id=row["external_id"].strip(),
                        name=row["name"],
                        kcal_100g=float(row["kcal_100g"]),
                        protein_100g=float(row["protein_100g"]),
                        carbs_100g=float(row["carbs_100g"]),
                        fat_100g=float(row["fat_100g"]),
                        fiber_100g=float(row["fiber_100g"]) if row.get("fiber_100g") else None,
                        servings=serving,
                    )
                )
            except (KeyError, ValueError) as exc:
                raise CsvError(f"line {line}: {exc}") from exc
            if not foods[-1].external_id or not foods[-1].name.strip():
                raise CsvError(f"line {line}: external_id and name are required")
    return foods
