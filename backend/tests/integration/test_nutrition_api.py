import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import FoodSource
from app.services import nutrition
from app.services.food_library import apply_seed, library_food_id
from tests.integration.helpers import bearer, register_user

pytestmark = pytest.mark.integration

Headers = dict[str, str]
Json = dict[str, Any]

DAL = str(library_food_id(FoodSource.USDA, "2707427"))
RICE = str(library_food_id(FoodSource.USDA, "168878"))
DAY = "2026-10-30"


@pytest.fixture
async def auth(
    api_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> Headers:
    async with session_factory() as session:
        await apply_seed(session)
    return bearer(await register_user(api_client))


@pytest.fixture
async def other_auth(api_client: AsyncClient, auth: Headers) -> Headers:
    return bearer(await register_user(api_client, email="other@example.com"))


async def onboard(client: AsyncClient, auth: Headers, **overrides: Any) -> None:
    response = await client.patch(
        "/v1/me/profile",
        headers=auth,
        json={
            "sex": "male",
            "birth_date": "1996-01-15",
            "height_cm": 180,
            "weight_kg": 80,
            "activity_level": "moderate",
            "goal": "maintain",
            "experience": "intermediate",
            "onboarding_complete": True,
            **overrides,
        },
    )
    assert response.status_code == 200, response.text


def custom_food(**overrides: Any) -> Json:
    return {
        "name": "Mom's dal",
        "kcal_100g": 120,
        "protein_100g": 7,
        "carbs_100g": 15,
        "fat_100g": 3,
        "servings": [{"label": "1 katori", "grams": 150}],
        **overrides,
    }


async def post(client: AsyncClient, auth: Headers, path: str, body: Json) -> Any:
    response = await client.post(path, headers=auth, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def log_body(food_id: str = DAL, grams: float = 250, **overrides: Any) -> Json:
    return {
        "log_date": DAY,
        "meal": "lunch",
        "food_id": food_id,
        "quantity": grams,
        "unit": "g",
        "grams": grams,
        "source": "search",
        **overrides,
    }


# --- custom foods -----------------------------------------------------------------------


async def test_custom_food_crud(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    food = await post(api_client, auth, "/v1/foods", custom_food(brand="  Home  "))
    path = f"/v1/foods/{food['id']}"

    edited = await api_client.patch(
        path,
        headers=auth,
        json={"kcal_100g": 130, "servings": [{"label": "1 bowl", "grams": 200}]},
    )
    no_change = await api_client.patch(path, headers=auth, json={"kcal_100g": 130})
    servings_only = await api_client.patch(
        path, headers=auth, json={"servings": [{"label": "1 cup", "grams": 240}]}
    )
    cleared = await api_client.patch(path, headers=auth, json={"brand": None})
    theirs = await api_client.patch(path, headers=other_auth, json={"kcal_100g": 1})
    library = await api_client.patch(f"/v1/foods/{DAL}", headers=auth, json={"kcal_100g": 1})
    removed = await api_client.delete(path, headers=auth)
    gone = await api_client.get(path, headers=auth)

    assert (food["source"], food["is_custom"], food["brand"]) == ("custom", True, "Home")
    assert food["servings"] == [{"label": "1 katori", "grams": 150.0}]
    assert (edited.json()["kcal_100g"], edited.json()["version"]) == (130, 2)
    assert no_change.json()["version"] == 2
    assert servings_only.json()["version"] == 3
    assert cleared.json()["brand"] is None
    assert theirs.status_code == 404
    assert (library.status_code, library.json()["error"]["code"]) == (
        403,
        "library_food_read_only",
    )
    assert (removed.status_code, gone.status_code) == (204, 404)


async def test_a_food_id_is_used_once(api_client: AsyncClient, auth: Headers) -> None:
    food_id = str(uuid.uuid4())
    await post(api_client, auth, "/v1/foods", custom_food(id=food_id))

    again = await api_client.post("/v1/foods", headers=auth, json=custom_food(id=food_id))

    assert (again.status_code, again.json()["error"]["code"]) == (409, "food_exists")


# --- logs -------------------------------------------------------------------------------


async def test_a_log_snapshots_the_food_and_scales_it(
    api_client: AsyncClient, auth: Headers
) -> None:
    log = await post(api_client, auth, "/v1/food-logs", log_body())

    assert (log["name"], log["food_id"], log["source"]) == ("Dal", DAL, "search")
    assert log["per_100g"]["kcal"] == 145
    assert (log["kcal"], log["protein_g"], log["carbs_g"], log["fat_g"]) == (
        362.5,
        21.5,
        47.9,
        10.8,
    )
    assert (log["macros_overridden"], log["kcal_overridden"]) == (False, False)


async def test_editing_a_custom_food_leaves_past_logs_unchanged(
    api_client: AsyncClient, auth: Headers
) -> None:
    food = await post(api_client, auth, "/v1/foods", custom_food())
    log = await post(api_client, auth, "/v1/food-logs", log_body(food["id"], 100))

    await api_client.patch(
        f"/v1/foods/{food['id']}",
        headers=auth,
        json={"name": "Dal v2", "kcal_100g": 500, "protein_100g": 50},
    )
    after_edit = await api_client.get(f"/v1/food-logs/{log['id']}", headers=auth)
    await api_client.delete(f"/v1/foods/{food['id']}", headers=auth)
    after_delete = await api_client.get(f"/v1/food-logs/{log['id']}", headers=auth)
    rescaled = await api_client.patch(
        f"/v1/food-logs/{log['id']}", headers=auth, json={"quantity": 200, "grams": 200}
    )
    newer = await post(api_client, auth, "/v1/food-logs", log_body(food["id"], 100))

    assert after_edit.json() == log
    assert after_delete.json() == log
    # Rescaling uses the snapshot, not the edited food.
    assert (rescaled.json()["name"], rescaled.json()["kcal"]) == ("Mom's dal", 240)
    assert (newer["name"], newer["kcal"]) == ("Dal v2", 500)


async def test_editing_protein_recomputes_kcal(api_client: AsyncClient, auth: Headers) -> None:
    log = await post(api_client, auth, "/v1/food-logs", log_body())
    path = f"/v1/food-logs/{log['id']}"

    macros = await api_client.patch(
        path,
        headers=auth,
        json={"macros": {"protein_g": 30, "carbs_g": 47.9, "fat_g": 10.8, "fiber_g": 18}},
    )
    moved = await api_client.patch(path, headers=auth, json={"meal": "dinner"})
    manual = await api_client.patch(path, headers=auth, json={"kcal": 400})
    back_to_macros = await api_client.patch(path, headers=auth, json={"kcal": None})
    back_to_food = await api_client.patch(path, headers=auth, json={"macros": None})

    assert (macros.json()["kcal"], macros.json()["macros_overridden"]) == (408.8, True)
    assert (moved.json()["meal"], moved.json()["protein_g"]) == ("dinner", 30)
    assert (manual.json()["kcal"], manual.json()["kcal_overridden"]) == (400, True)
    assert (back_to_macros.json()["kcal"], back_to_macros.json()["kcal_overridden"]) == (
        408.8,
        False,
    )
    assert (back_to_food.json()["kcal"], back_to_food.json()["macros_overridden"]) == (362.5, False)


async def test_a_one_off_log_needs_a_name_and_values(
    api_client: AsyncClient, auth: Headers
) -> None:
    body = log_body(grams=100)
    del body["food_id"]

    no_name = await api_client.post("/v1/food-logs", headers=auth, json=body)
    no_values = await api_client.post(
        "/v1/food-logs", headers=auth, json={**body, "name": "Street momos"}
    )
    log = await post(
        api_client,
        auth,
        "/v1/food-logs",
        {
            **body,
            "name": "Street momos",
            "per_100g": {"kcal": 200, "protein": 8, "carbs": 25, "fat": 7},
        },
    )

    assert no_name.json()["error"]["details"][0]["loc"] == ["body", "name"]
    assert no_values.json()["error"]["details"][0]["loc"] == ["body", "per_100g"]
    assert (log["food_id"], log["kcal"]) == (None, 200)


async def test_logs_are_private_and_deletable(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    log = await post(api_client, auth, "/v1/food-logs", log_body())
    path = f"/v1/food-logs/{log['id']}"

    theirs = await api_client.get(path, headers=other_auth)
    taken = await api_client.post("/v1/food-logs", headers=auth, json=log_body(id=log["id"]))
    removed = await api_client.delete(path, headers=auth)
    gone = await api_client.get(path, headers=auth)

    assert theirs.status_code == 404
    assert (taken.status_code, taken.json()["error"]["code"]) == (409, "food_log_exists")
    assert (removed.status_code, gone.status_code) == (204, 404)


async def test_another_users_food_is_not_linked(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    theirs = await post(api_client, other_auth, "/v1/foods", custom_food())

    response = await api_client.post("/v1/food-logs", headers=auth, json=log_body(theirs["id"]))

    assert response.json()["error"]["details"][0]["loc"] == ["body", "name"]


# --- the day ----------------------------------------------------------------------------


async def test_the_day_groups_meals_with_totals_and_targets(
    api_client: AsyncClient, auth: Headers
) -> None:
    await onboard(api_client, auth)
    await post(api_client, auth, "/v1/food-logs", log_body(DAL, 200))
    await post(api_client, auth, "/v1/food-logs", log_body(RICE, 100))
    await post(api_client, auth, "/v1/food-logs", log_body(RICE, 100, meal="breakfast"))
    other_day = log_body(RICE, 500, log_date="2026-10-29")
    await post(api_client, auth, "/v1/food-logs", other_day)

    body = (await api_client.get(f"/v1/nutrition/day?date={DAY}", headers=auth)).json()

    assert list(body["meals"]) == ["breakfast", "lunch", "dinner", "snack"]
    assert [log["name"] for log in body["meals"]["lunch"]] == ["Dal", "White rice, cooked"]
    assert body["meals"]["dinner"] == []
    assert body["totals"]["kcal"] == 550  # 290 + 130 + 130
    assert body["totals"]["fiber_g"] == 15.8
    assert body["targets"]["kcal"] == 2750


async def test_the_day_defaults_to_today_and_copes_without_a_profile(
    api_client: AsyncClient, auth: Headers
) -> None:
    body = (await api_client.get("/v1/nutrition/day", headers=auth)).json()

    assert body["date"] == datetime.now(UTC).date().isoformat()
    assert body["targets"] is None
    assert body["totals"]["kcal"] == 0


async def test_copying_a_meal_and_a_day(api_client: AsyncClient, auth: Headers) -> None:
    log = await post(api_client, auth, "/v1/food-logs", log_body(DAL, 200))
    await api_client.patch(
        f"/v1/food-logs/{log['id']}",
        headers=auth,
        json={"macros": {"protein_g": 20, "carbs_g": 40, "fat_g": 10}},
    )
    await post(api_client, auth, "/v1/food-logs", log_body(RICE, 100, meal="dinner"))

    meal = await post(
        api_client,
        auth,
        "/v1/food-logs/copy",
        {"from_date": DAY, "to_date": "2026-10-31", "from_meal": "lunch", "to_meal": "snack"},
    )
    day = await post(
        api_client, auth, "/v1/food-logs/copy", {"from_date": DAY, "to_date": "2026-11-01"}
    )

    assert [(c["meal"], c["log_date"], c["kcal"]) for c in meal] == [("snack", "2026-10-31", 330)]
    assert meal[0]["macros_overridden"] is True and meal[0]["id"] != log["id"]
    assert sorted(c["meal"] for c in day) == ["dinner", "lunch"]


# --- targets ----------------------------------------------------------------------------


async def test_first_targets_come_from_onboarding(api_client: AsyncClient, auth: Headers) -> None:
    missing = await api_client.get("/v1/nutrition/targets", headers=auth)
    await onboard(api_client, auth, goal="fat_loss")

    first = await api_client.get("/v1/nutrition/targets", headers=auth)
    again = await api_client.get("/v1/nutrition/targets", headers=auth)
    past = await api_client.get("/v1/nutrition/targets?date=2020-01-01", headers=auth)

    assert (missing.status_code, missing.json()["error"]["code"]) == (409, "profile_incomplete")
    body = first.json()
    assert body["reason"] == "initial"
    assert (body["protein_g"], body["kcal"]) == (144, 2100)
    assert again.json() == body
    # Before the first row, the first row applies.
    assert past.json() == body


async def test_manual_targets_replace_today_and_respect_the_floor(
    api_client: AsyncClient, auth: Headers
) -> None:
    await onboard(api_client, auth)
    await api_client.get("/v1/nutrition/targets", headers=auth)

    too_low = await api_client.post(
        "/v1/nutrition/targets",
        headers=auth,
        json={"kcal": 1400, "protein_g": 150, "carbs_g": 100, "fat_g": 40},
    )
    mine = {"kcal": 2500, "protein_g": 170, "carbs_g": 280, "fat_g": 75}
    saved = await post(api_client, auth, "/v1/nutrition/targets", mine)
    current = (await api_client.get("/v1/nutrition/targets", headers=auth)).json()

    assert too_low.status_code == 422
    assert too_low.json()["error"]["code"] == "target_below_safe_minimum"
    # BMR for this profile is above 1500.
    assert too_low.json()["error"]["details"]["minimum_kcal"] >= 1750
    assert (saved["reason"], saved["kcal"]) == ("manual", 2500)
    assert current == saved


async def test_manual_targets_before_onboarding_use_the_general_floor(
    api_client: AsyncClient, auth: Headers
) -> None:
    body = {"kcal": 1100, "protein_g": 80, "carbs_g": 100, "fat_g": 40}

    low = await api_client.post("/v1/nutrition/targets", headers=auth, json=body)
    fine = await post(api_client, auth, "/v1/nutrition/targets", {**body, "kcal": 1300})

    assert low.json()["error"]["details"] == {"minimum_kcal": 1200}
    assert fine["kcal"] == 1300


async def test_two_first_requests_end_with_one_row(
    api_client: AsyncClient, auth: Headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    await onboard(api_client, auth)
    first = (await api_client.get("/v1/nutrition/targets", headers=auth)).json()
    real = nutrition._latest_target
    calls = 0

    async def misses_once(*args: Any) -> Any:
        nonlocal calls
        calls += 1
        return None if calls == 1 else await real(*args)

    monkeypatch.setattr(nutrition, "_latest_target", misses_once)

    again = await api_client.get("/v1/nutrition/targets", headers=auth)

    assert again.json() == first and calls == 2


# --- saved meals ------------------------------------------------------------------------


def meal_body(**overrides: Any) -> Json:
    return {
        "name": "Usual lunch",
        "items": [
            {"food_id": DAL, "quantity": 1, "unit": "1 cup", "grams": 240},
            {"food_id": RICE, "quantity": 150, "unit": "g", "grams": 150},
        ],
        **overrides,
    }


async def test_saved_meal_crud_and_logging(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    meal = await post(api_client, auth, "/v1/saved-meals", meal_body())
    path = f"/v1/saved-meals/{meal['id']}"

    renamed = await api_client.patch(path, headers=auth, json={"name": "Lunch A"})
    same = await api_client.patch(path, headers=auth, json={"name": "Lunch A"})
    shorter = await api_client.patch(
        path,
        headers=auth,
        json={"items": [{"food_id": RICE, "quantity": 2, "unit": "1 cup", "grams": 316}]},
    )
    listed = await api_client.get("/v1/saved-meals", headers=auth)
    fetched = await api_client.get(path, headers=auth)
    logged = await post(api_client, auth, f"{path}/log", {"log_date": DAY, "meal": "dinner"})
    theirs = await api_client.get(path, headers=other_auth)
    removed = await api_client.delete(path, headers=auth)
    gone = await api_client.get(path, headers=auth)

    assert [i["name"] for i in meal["items"]] == ["Dal", "White rice, cooked"]
    assert meal["items"][0]["per_100g"]["kcal"] == 145
    assert (renamed.json()["version"], same.json()["version"]) == (2, 2)
    assert shorter.json()["version"] == 3 and len(shorter.json()["items"]) == 1
    assert [m["name"] for m in listed.json()] == ["Lunch A"]
    assert fetched.json() == shorter.json()
    assert [(log["name"], log["meal"], log["grams"], log["unit"]) for log in logged] == [
        ("White rice, cooked", "dinner", 316, "1 cup")
    ]
    assert theirs.status_code == 404
    assert (removed.status_code, gone.status_code) == (204, 404)


async def test_a_saved_meal_needs_known_foods(api_client: AsyncClient, auth: Headers) -> None:
    body = meal_body()
    body["items"][1]["food_id"] = str(uuid.uuid4())

    response = await api_client.post("/v1/saved-meals", headers=auth, json=body)
    empty = await api_client.post("/v1/saved-meals", headers=auth, json=meal_body(items=[]))

    assert response.json()["error"]["details"][0]["loc"] == ["body", "items", 1, "food_id"]
    assert empty.status_code == 422


# --- sync -------------------------------------------------------------------------------


async def test_foods_logs_and_saved_meals_sync(api_client: AsyncClient, auth: Headers) -> None:
    food_id, log_id, meal_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())

    async def push(*changes: Json) -> list[Json]:
        response = await api_client.post(
            "/v1/sync/push", headers=auth, json={"changes": list(changes)}
        )
        results: list[Json] = response.json()["results"]
        return results

    def upsert(entity: str, row_id: str, data: Json) -> Json:
        return {"entity": entity, "id": row_id, "op": "upsert", "data": data}

    log_data = {
        **log_body(food_id, 100),
        "name": "Offline dal",
        "per_100g": {"kcal": 120, "protein": 7, "carbs": 15, "fat": 3},
    }
    meal_data = meal_body(items=[{"food_id": food_id, "quantity": 100, "unit": "g", "grams": 100}])
    results = await push(
        upsert("food", food_id, custom_food()),
        upsert("food_log", log_id, log_data),
        upsert("saved_meal", meal_id, meal_data),
    )
    edited = await push(
        upsert("food", food_id, custom_food(name="Renamed", servings=[])),
        upsert("food_log", log_id, {**log_data, "quantity": 200, "grams": 200}),
        upsert("saved_meal", meal_id, {**meal_data, "name": "Renamed meal"}),
    )
    resent = await push(upsert("food", food_id, custom_food(name="Renamed", servings=[])))
    servings_only = await push(
        upsert(
            "food",
            food_id,
            custom_food(name="Renamed", servings=[{"label": "1 bowl", "grams": 200}]),
        )
    )
    pulled = (await api_client.get("/v1/sync/pull", headers=auth)).json()["changes"]
    library = await push(upsert("food", DAL, custom_food()))
    deleted = await push(
        {"entity": "saved_meal", "id": meal_id, "op": "delete"},
        {"entity": "food_log", "id": log_id, "op": "delete"},
        {"entity": "food", "id": food_id, "op": "delete"},
    )

    assert [r["status"] for r in results] == ["applied"] * 3
    # The name typed offline stays: the log is a snapshot.
    assert results[1]["data"]["name"] == "Offline dal"
    assert (edited[0]["data"]["name"], edited[0]["data"]["version"]) == ("Renamed", 2)
    assert (edited[1]["data"]["kcal"], edited[1]["data"]["version"]) == (240, 2)
    assert edited[2]["data"]["name"] == "Renamed meal"
    assert {("food", food_id), ("food_log", log_id), ("saved_meal", meal_id)} <= {
        (c["entity"], c["id"]) for c in pulled
    }
    assert resent[0]["data"]["version"] == 2
    assert servings_only[0]["data"]["version"] == 3
    assert library[0]["error"]["code"] == "library_food_read_only"
    assert library[0]["deleted"] is False and library[0]["data"]["name"] == "Dal"
    assert [r["status"] for r in deleted] == ["applied"] * 3
