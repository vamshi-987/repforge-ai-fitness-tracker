"""Build `seeds/foods.json` from USDA FoodData Central CSV downloads (public domain).

    python scripts/build_usda_foods.py <sr_legacy_dir> <fndds_dir> > seeds/foods.json

Download "SR Legacy" and "FNDDS" (Survey) as CSV from https://fdc.nal.usda.gov/download-datasets
and unzip them. Every food keeps its FDC id, so each value can be checked at
https://fdc.nal.usda.gov/food-details/<fdc_id>. IFCT values are not used: the Indian Food
Composition Tables are copyrighted by NIN/ICMR (see `app/commands/import_foods.py`).
"""

import csv
import json
import sys
from pathlib import Path

# FDC id → the name shown in the app (USDA descriptions are long).
CURATED: dict[int, str] = {
    171844: "Roti / chapati",
    2707613: "Naan",
    2707715: "Paratha",
    2707427: "Dal",
    2707431: "Lentil curry",
    2706437: "Chicken curry",
    2706538: "Chicken biryani",
    2708985: "Vegetable biryani",
    2705740: "Paneer",
    2709631: "Palak paneer",
    2708346: "Idli",
    2708347: "Dosa, plain",
    2709129: "Masala dosa",
    2708730: "Samosa",
    2709128: "Upma",
    2710066: "Pakora",
    171314: "Ghee",
    2707416: "Chana (chickpeas), cooked",
    173757: "Chickpeas, boiled",
    172421: "Lentils, boiled",
    175194: "Rajma (kidney beans), boiled",
    168878: "White rice, cooked",
    169704: "Brown rice, cooked",
    171477: "Chicken breast, roasted",
    171287: "Egg, whole, raw",
    173424: "Egg, hard-boiled",
    171265: "Milk, whole",
    171267: "Milk, 2% fat",
    171284: "Curd / plain yogurt, whole milk",
    170894: "Greek yogurt, plain, nonfat",
    173944: "Banana",
    171688: "Apple, with skin",
    169910: "Mango",
    169097: "Orange",
    173904: "Oats, dry",
    174266: "Peanut butter",
    170567: "Almonds",
    172688: "Whole-wheat bread",
    170440: "Potato, boiled",
    168483: "Sweet potato, baked",
    169967: "Broccoli, boiled",
    168462: "Spinach, raw",
    170457: "Tomato",
    170000: "Onion",
    175168: "Salmon, cooked",
    173709: "Tuna, canned in water",
    174032: "Ground beef 85% lean, cooked",
    2705709: "Cheddar cheese",
    172182: "Cottage cheese, 2% fat",
    171413: "Olive oil",
    169655: "Sugar",
    171890: "Coffee, brewed",
    172475: "Tofu, firm",
    169737: "Pasta, cooked",
    171705: "Avocado",
    173177: "Whey protein isolate",
}

# SR Legacy's food_nutrient.csv uses nutrient ids; FNDDS uses the older nutrient numbers.
NUTRIENTS = {
    "1008": "kcal_100g",
    "208": "kcal_100g",
    "1003": "protein_100g",
    "203": "protein_100g",
    "1005": "carbs_100g",
    "205": "carbs_100g",
    "1004": "fat_100g",
    "204": "fat_100g",
    "1079": "fiber_100g",
    "291": "fiber_100g",
}
FIELDS = ("kcal_100g", "protein_100g", "carbs_100g", "fat_100g", "fiber_100g")
MAX_SERVINGS = 4


def _rows(directory: Path, name: str) -> list[dict[str, str]]:
    (path,) = directory.rglob(name)
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def _label(row: dict[str, str]) -> str | None:
    description = row.get("portion_description", "").strip()
    # FNDDS marks "quantity not specified" with the code 90000; such portions are skipped.
    if description.isdigit():
        return None
    if description and "not specified" not in description.lower():
        return description[:80]
    amount, modifier = row.get("amount", "").strip(), row.get("modifier", "").strip()
    if not modifier or modifier.isdigit():
        return None
    number = amount.rstrip("0").rstrip(".") if "." in amount else amount
    return f"{number} {modifier}".strip()[:80]


def build(directories: list[Path]) -> list[dict[str, object]]:
    wanted = {str(fdc_id) for fdc_id in CURATED}
    descriptions: dict[str, str] = {}
    values: dict[str, dict[str, float]] = {key: {} for key in wanted}
    servings: dict[str, list[dict[str, object]]] = {key: [] for key in wanted}
    for directory in directories:
        for row in _rows(directory, "food.csv"):
            if row["fdc_id"] in wanted:
                descriptions[row["fdc_id"]] = row["description"]
        for row in _rows(directory, "food_nutrient.csv"):
            field = NUTRIENTS.get(row["nutrient_id"])
            if row["fdc_id"] in wanted and field:
                values[row["fdc_id"]][field] = round(float(row["amount"]), 2)
        for row in _rows(directory, "food_portion.csv"):
            label = _label(row)
            grams = float(row["gram_weight"] or 0)
            if row["fdc_id"] in wanted and label and grams > 0:
                servings[row["fdc_id"]].append({"label": label, "grams": round(grams, 2)})

    missing = sorted(wanted - set(descriptions))
    if missing:
        raise SystemExit(f"not in the downloads: {missing}")
    foods = []
    for fdc_id, name in CURATED.items():
        key = str(fdc_id)
        nutrients = values[key]
        incomplete = [f for f in FIELDS if f != "fiber_100g" and f not in nutrients]
        if incomplete:
            raise SystemExit(f"{fdc_id} {name}: no {incomplete}")
        foods.append(
            {
                "fdc_id": fdc_id,
                "name": name,
                "usda_description": descriptions[key],
                **{field: nutrients.get(field) for field in FIELDS},
                "servings": servings[key][:MAX_SERVINGS],
            }
        )
    return sorted(foods, key=lambda f: str(f["name"]))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    json.dump(build([Path(arg) for arg in sys.argv[1:]]), sys.stdout, indent=1)
    sys.stdout.write("\n")
