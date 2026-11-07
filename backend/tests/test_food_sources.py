"""Normalising USDA FoodData Central and Open Food Facts records (shapes as their APIs send)."""

import pytest

from app.services.food_library import Serving
from app.services.food_search import normalize_query, off_food, tidy_name, usda_food


def nutrients(**by_number: float) -> list[dict[str, object]]:
    return [{"nutrientNumber": n, "value": v, "unitName": "G"} for n, v in by_number.items()]


def test_a_usda_survey_food() -> None:
    food = usda_food(
        {
            "fdcId": 2707427,
            "description": "Dal",
            "dataType": "Survey (FNDDS)",
            "foodNutrients": [
                *nutrients(**{"208": 145, "203": 8.6, "205": 19.17, "204": 4.31, "291": 7.5})
            ],
        }
    )

    assert food is not None
    assert (food.external_id, food.name, food.kcal_100g, food.fiber_100g) == (
        "2707427",
        "Dal",
        145,
        7.5,
    )
    assert food.servings == () and food.brand is None


def test_a_usda_branded_food_with_a_serving() -> None:
    food = usda_food(
        {
            "fdcId": 9,
            "description": "PROTEIN BAR, CHOCOLATE",
            "brandOwner": "ACME FOODS",
            "gtinUpc": "012345678905",
            "servingSize": 60,
            "servingSizeUnit": "g",
            "householdServingFullText": "1 bar",
            "foodNutrients": nutrients(**{"208": 380, "203": 33.3, "205": 40, "204": 10}),
        }
    )

    assert food is not None
    assert (food.name, food.brand, food.barcode) == (
        "Protein Bar, Chocolate",
        "Acme Foods",
        "012345678905",
    )
    assert food.servings == (Serving("1 bar", 60),)


@pytest.mark.parametrize(
    ("numbers", "kcal"),
    [
        ({"957": 120.0, "203": 1, "205": 2, "204": 3}, 120.0),  # Foundation: Atwater energy
        ({"268": 418.4, "203": 1, "205": 2, "204": 3}, 100.0),  # kJ only
        ({"203": 1, "205": 2, "204": 3}, None),  # no energy at all
        ({"208": 100, "203": 1, "204": 3}, None),  # no carbs
    ],
)
def test_usda_energy_fallbacks(numbers: dict[str, float], kcal: float | None) -> None:
    food = usda_food({"fdcId": 1, "description": "x", "foodNutrients": nutrients(**numbers)})
    assert (food.kcal_100g if food else None) == (kcal if kcal is None else pytest.approx(kcal))


def test_an_open_food_facts_product() -> None:
    food = off_food(
        {
            "code": "3017620422003",
            "product_name": "Nutella",
            "brands": "Ferrero, Nutella",
            "serving_size": "15 g",
            "serving_quantity": 15,
            "nutriments": {
                "energy-kcal_100g": 539,
                "proteins_100g": 6.3,
                "carbohydrates_100g": 57.5,
                "fat_100g": 30.9,
            },
        }
    )

    assert food is not None
    assert (food.external_id, food.barcode, food.brand) == (
        "3017620422003",
        "3017620422003",
        "Ferrero",
    )
    assert (food.kcal_100g, food.fiber_100g) == (539, None)
    assert food.servings == (Serving("15 g", 15),)


@pytest.mark.parametrize(
    "product",
    [
        {"code": "1", "nutriments": {"energy-kcal_100g": 1}},  # no name
        {"code": "1", "product_name": "Water", "nutriments": {"energy-kcal_100g": 0}},  # no macros
        {"product_name": "x", "nutriments": {}},
    ],
)
def test_incomplete_products_are_skipped(product: dict[str, object]) -> None:
    assert off_food(product) is None


def test_open_food_facts_kj_fallback() -> None:
    food = off_food(
        {
            "code": "1",
            "product_name": "Biscuits",
            "nutriments": {
                "energy_100g": 2092,
                "proteins_100g": 7,
                "carbohydrates_100g": 70,
                "fat_100g": 20,
            },
        }
    )
    assert food is not None and round(food.kcal_100g) == 500


@pytest.mark.parametrize(
    "nutriments",
    [
        # kJ typed into the kcal field.
        {"energy-kcal_100g": 1500, "proteins_100g": 5, "carbohydrates_100g": 50, "fat_100g": 5},
        {"energy-kcal_100g": 300, "proteins_100g": 240, "carbohydrates_100g": 5, "fat_100g": 5},
        {"energy-kcal_100g": -1, "proteins_100g": 5, "carbohydrates_100g": 5, "fat_100g": 5},
    ],
)
def test_impossible_values_are_dropped(nutriments: dict[str, float]) -> None:
    assert off_food({"code": "123", "product_name": "Typo", "nutriments": nutriments}) is None


def test_impossible_usda_values_are_dropped() -> None:
    numbers = {"208": 2000, "203": 1, "205": 1, "204": 1}
    assert usda_food({"fdcId": 1, "foodNutrients": nutrients(**numbers)}) is None


def test_only_the_fiber_is_dropped_when_it_alone_is_impossible() -> None:
    food = off_food(
        {
            "code": "123",
            "product_name": "Oats",
            "nutriments": {
                "energy-kcal_100g": 380,
                "proteins_100g": 13,
                "carbohydrates_100g": 60,
                "fat_100g": 7,
                "fiber_100g": 140,
            },
        }
    )

    assert food is not None
    assert (food.kcal_100g, food.fiber_100g) == (380, None)


def test_text_helpers() -> None:
    assert normalize_query("  Chicken   BIRYANI ") == "chicken biryani"
    assert tidy_name("PEANUT  BUTTER") == "Peanut Butter"
    assert tidy_name("Roti / chapati") == "Roti / chapati"


def test_unreadable_values_count_as_missing() -> None:
    food = usda_food(
        {
            "fdcId": 1,
            "description": "x",
            "foodNutrients": [
                {"nutrientNumber": "208", "value": "n/a"},
                {"nutrientNumber": "203", "value": 1},
                {"nutrientNumber": "205", "value": 1},
                {"nutrientNumber": "204", "value": 1},
            ],
        }
    )
    assert food is None
