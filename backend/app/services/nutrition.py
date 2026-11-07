"""Custom foods, food logs, the daily view, saved meals and targets.

A log holds a snapshot of the food's name and per-100 g values, so editing or deleting the food
never rewrites history. Amounts always come from `macros.log_amounts`. Custom foods, logs and
saved meals are offline-synced rows, written through `put_*` by both REST and sync.
"""

import uuid
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError, ConflictError, NotFoundError
from app.db.change_lock import lock_changes
from app.db.models import (
    Food,
    FoodLog,
    FoodServing,
    FoodSource,
    LogSource,
    Meal,
    NutritionTarget,
    SavedMeal,
    SavedMealItem,
    Sex,
    TargetReason,
    User,
)
from app.schemas.foods import FoodOut
from app.schemas.nutrition import (
    FoodIn,
    FoodLogCopy,
    FoodLogIn,
    FoodLogOut,
    FoodLogUpdate,
    FoodUpdate,
    MacrosIn,
    NutritionDay,
    NutritionTotals,
    Per100gIn,
    SavedMealIn,
    SavedMealItemIn,
    SavedMealItemOut,
    SavedMealLog,
    SavedMealOut,
    SavedMealUpdate,
    TargetsIn,
    TargetsOut,
)
from app.services.body import apply_changes, commit_new, ensure_id_free
from app.services.food_search import food_out
from app.services.macros import MacroOverride, Per100g, log_amounts
from app.services.nutrition_engine import FLOOR_KCAL, bmr_mifflin, initial_targets, kcal_floor
from app.services.profile import (
    age_on,
    field_error,
    latest_weight_kg,
    load_profile,
    round_half_up,
)
from app.services.stats import local_day

# --- custom foods -----------------------------------------------------------------------


def food_tree() -> tuple[Any, ...]:
    return (selectinload(Food.servings),)


async def _custom_food(session: AsyncSession, user: User, food_id: uuid.UUID) -> Food:
    food = await session.scalar(
        select(Food)
        .where(Food.id == food_id)
        .options(*food_tree())
        .execution_options(populate_existing=True)
    )
    if food is None or food.deleted_at is not None or food.owner_user_id not in (None, user.id):
        raise NotFoundError("Food not found")
    if food.owner_user_id is None:
        raise AppError("library_food_read_only", "Library foods can't be changed", 403)
    return food


def _set_servings(food: Food, servings: Sequence[Any]) -> bool:
    wanted = [(s.label, round_half_up(s.grams, 2)) for s in servings]
    if [(s.label, s.grams) for s in food.servings] == wanted:
        return False
    food.servings.clear()
    food.servings.extend(
        FoodServing(position=i, label=label, grams=grams) for i, (label, grams) in enumerate(wanted)
    )
    return True


async def put_food(session: AsyncSession, user: User, food_id: uuid.UUID, body: FoodIn) -> FoodOut:
    """Create the custom food, or set it to this state (the sync upsert). Past logs keep
    their snapshots, whatever changes here."""
    await lock_changes(session, user.id)
    fields = body.model_dump(exclude={"id", "servings"})
    if await session.get(Food, food_id) is None:
        food = Food(id=food_id, owner_user_id=user.id, source=FoodSource.CUSTOM, **fields)
        food.servings = []
        _set_servings(food, body.servings)
        session.add(food)
        await commit_new(session, "food_exists")
    else:
        food = await _custom_food(session, user, food_id)
        new_servings = _set_servings(food, body.servings)
        if not apply_changes(food, fields) and new_servings:
            food.version += 1
        await session.commit()
    return food_out(await _custom_food(session, user, food_id))


async def create_food(session: AsyncSession, user: User, body: FoodIn) -> FoodOut:
    await ensure_id_free(session, Food, body.id, "food_exists")
    return await put_food(session, user, body.id or uuid.uuid4(), body)


async def update_food(
    session: AsyncSession, user: User, food_id: uuid.UUID, patch: FoodUpdate
) -> FoodOut:
    food = await _custom_food(session, user, food_id)
    changes = patch.changes()
    servings = patch.servings if "servings" in changes else None
    changes.pop("servings", None)
    new_servings = servings is not None and _set_servings(food, servings)
    if not apply_changes(food, changes) and new_servings:
        food.version += 1
    await session.commit()
    return food_out(await _custom_food(session, user, food_id))


async def delete_food(session: AsyncSession, user: User, food_id: uuid.UUID, now: datetime) -> None:
    food = await _custom_food(session, user, food_id)
    food.deleted_at = now
    food.version += 1
    await session.commit()


# --- food logs --------------------------------------------------------------------------


def _per_100g(row: FoodLog) -> Per100g:
    return Per100g(row.kcal_100g, row.protein_100g, row.carbs_100g, row.fat_100g, row.fiber_100g)


def log_out(row: FoodLog) -> FoodLogOut:
    return FoodLogOut(
        id=row.id,
        log_date=row.log_date,
        meal=row.meal,
        food_id=row.food_id,
        name=row.name_snapshot,
        brand=row.brand_snapshot,
        per_100g=Per100gIn(
            kcal=row.kcal_100g,
            protein=row.protein_100g,
            carbs=row.carbs_100g,
            fat=row.fat_100g,
            fiber=row.fiber_100g,
        ),
        quantity=row.quantity,
        unit=row.unit,
        grams=row.grams,
        kcal=row.kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        fat_g=row.fat_g,
        fiber_g=row.fiber_g,
        macros_overridden=row.macros_overridden,
        kcal_overridden=row.kcal_overridden,
        source=row.source,
        photo_analysis_id=row.photo_analysis_id,
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _visible_food(
    session: AsyncSession, user: User, food_id: uuid.UUID | None
) -> Food | None:
    """The food if the user can use it. Deleted ones count: an offline log may predate it."""
    if food_id is None:
        return None
    food = await session.get(Food, food_id)
    return food if food is not None and food.owner_user_id in (None, user.id) else None


def _amount_fields(
    per_100g: Per100g, grams: float, macros: MacrosIn | None, kcal: float | None
) -> dict[str, Any]:
    override = (
        None
        if macros is None
        else MacroOverride(macros.protein_g, macros.carbs_g, macros.fat_g, macros.fiber_g)
    )
    amounts = log_amounts(per_100g, grams, override, kcal)
    return {
        "kcal": amounts.kcal,
        "protein_g": amounts.protein_g,
        "carbs_g": amounts.carbs_g,
        "fat_g": amounts.fat_g,
        "fiber_g": amounts.fiber_g,
        "macros_overridden": amounts.macros_overridden,
        "kcal_overridden": amounts.kcal_overridden,
    }


async def put_log(
    session: AsyncSession, user: User, log_id: uuid.UUID, body: FoodLogIn
) -> FoodLogOut:
    """Create the log, or set it to this state (the sync upsert). The caller has checked that
    an existing row is the user's own and not deleted."""
    await lock_changes(session, user.id)
    food = await _visible_food(session, user, body.food_id)
    name = body.name or (food.name if food else None)
    if name is None:
        raise field_error("name", "a log without a food needs a name")
    if body.per_100g is not None:
        p = body.per_100g
        per_100g = Per100g(p.kcal, p.protein, p.carbs, p.fat, p.fiber)
    elif food is not None:
        per_100g = Per100g(
            food.kcal_100g, food.protein_100g, food.carbs_100g, food.fat_100g, food.fiber_100g
        )
    else:
        raise field_error("per_100g", "a log without a food needs per_100g")
    fields: dict[str, Any] = {
        "log_date": body.log_date,
        "meal": body.meal,
        "food_id": food.id if food else None,
        "name_snapshot": name,
        "brand_snapshot": body.brand or (food.brand if food else None),
        "quantity": round_half_up(body.quantity, 2),
        "unit": body.unit,
        "grams": round_half_up(body.grams, 2),
        "kcal_100g": per_100g.kcal,
        "protein_100g": per_100g.protein,
        "carbs_100g": per_100g.carbs,
        "fat_100g": per_100g.fat,
        "fiber_100g": per_100g.fiber,
        "source": body.source,
        "photo_analysis_id": body.photo_analysis_id,
        **_amount_fields(per_100g, body.grams, body.macros, body.kcal),
    }
    row = await session.get(FoodLog, log_id)
    if row is None:
        row = FoodLog(id=log_id, user_id=user.id, **fields)
        session.add(row)
        await commit_new(session, "food_log_exists")
    elif apply_changes(row, fields):
        await session.commit()
    return log_out(row)


async def create_log(session: AsyncSession, user: User, body: FoodLogIn) -> FoodLogOut:
    await ensure_id_free(session, FoodLog, body.id, "food_log_exists")
    return await put_log(session, user, body.id or uuid.uuid4(), body)


async def _owned_log(session: AsyncSession, user: User, log_id: uuid.UUID) -> FoodLog:
    row = await session.get(FoodLog, log_id)
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise NotFoundError("Food log not found")
    return row


async def get_log(session: AsyncSession, user: User, log_id: uuid.UUID) -> FoodLogOut:
    return log_out(await _owned_log(session, user, log_id))


async def update_log(
    session: AsyncSession, user: User, log_id: uuid.UUID, patch: FoodLogUpdate
) -> FoodLogOut:
    """Change a log. Amounts follow the snapshot, except macros or calories the user set: those
    stay as typed until they are sent as null."""
    row = await _owned_log(session, user, log_id)
    sent = patch.model_fields_set
    changes: dict[str, Any] = {
        name: getattr(patch, name)
        for name in ("log_date", "meal", "quantity", "unit", "grams")
        if name in sent
    }
    grams = patch.grams if "grams" in sent and patch.grams is not None else row.grams
    macros = patch.macros if "macros" in sent else None
    if "macros" not in sent and row.macros_overridden:
        macros = MacrosIn(
            protein_g=row.protein_g, carbs_g=row.carbs_g, fat_g=row.fat_g, fiber_g=row.fiber_g
        )
    kcal = patch.kcal if "kcal" in sent else (row.kcal if row.kcal_overridden else None)
    changes.update(_amount_fields(_per_100g(row), grams, macros, kcal))
    if apply_changes(row, changes):
        await session.commit()
    return log_out(row)


async def delete_log(session: AsyncSession, user: User, log_id: uuid.UUID, now: datetime) -> None:
    row = await _owned_log(session, user, log_id)
    row.deleted_at = now
    row.version += 1
    await session.commit()


async def _day_logs(
    session: AsyncSession, user: User, day: date, meal: Meal | None = None
) -> list[FoodLog]:
    query = select(FoodLog).where(
        FoodLog.user_id == user.id, FoodLog.log_date == day, FoodLog.deleted_at.is_(None)
    )
    if meal is not None:
        query = query.where(FoodLog.meal == meal)
    # created_at is the transaction's start, so rows written together tie (a copied meal);
    # change_seq keeps them in the order they were added.
    return list(await session.scalars(query.order_by(FoodLog.created_at, FoodLog.change_seq)))


async def copy_logs(session: AsyncSession, user: User, body: FoodLogCopy) -> list[FoodLogOut]:
    """New logs with the same snapshots and amounts on `to_date`."""
    await lock_changes(session, user.id)
    source = await _day_logs(session, user, body.from_date, body.from_meal)
    copied = []
    for row in source:
        copy = FoodLog(
            id=uuid.uuid4(),
            user_id=user.id,
            log_date=body.to_date,
            meal=body.to_meal or row.meal,
            food_id=row.food_id,
            name_snapshot=row.name_snapshot,
            brand_snapshot=row.brand_snapshot,
            quantity=row.quantity,
            unit=row.unit,
            grams=row.grams,
            kcal_100g=row.kcal_100g,
            protein_100g=row.protein_100g,
            carbs_100g=row.carbs_100g,
            fat_100g=row.fat_100g,
            fiber_100g=row.fiber_100g,
            kcal=row.kcal,
            protein_g=row.protein_g,
            carbs_g=row.carbs_g,
            fat_g=row.fat_g,
            fiber_g=row.fiber_g,
            macros_overridden=row.macros_overridden,
            kcal_overridden=row.kcal_overridden,
            source=row.source,
        )
        session.add(copy)
        copied.append(copy)
    await session.commit()
    return [log_out(row) for row in copied]


# --- targets ----------------------------------------------------------------------------


def _targets_out(row: NutritionTarget) -> TargetsOut:
    return TargetsOut(
        effective_from=row.effective_from,
        kcal=row.kcal,
        protein_g=row.protein_g,
        carbs_g=row.carbs_g,
        fat_g=row.fat_g,
        reason=row.reason,
    )


async def _latest_target(session: AsyncSession, user: User, day: date) -> NutritionTarget | None:
    """The row in force on `day`; before the first row, the first row."""
    query = select(NutritionTarget).where(NutritionTarget.user_id == user.id)
    current = await session.scalar(
        query.where(NutritionTarget.effective_from <= day)
        .order_by(NutritionTarget.effective_from.desc())
        .limit(1)
    )
    if current is not None:
        return current
    first: NutritionTarget | None = await session.scalar(
        query.order_by(NutritionTarget.effective_from).limit(1)
    )
    return first


async def _initial_row(session: AsyncSession, user: User, today: date) -> NutritionTarget | None:
    """Compute the first targets from the onboarding answers; None if any are missing."""
    profile = await load_profile(session, user.id)
    weight = await latest_weight_kg(session, user.id)
    if (
        profile.sex is None
        or profile.birth_date is None
        or profile.height_cm is None
        or weight is None
        or profile.activity_level is None
        or profile.goal is None
        or profile.experience is None
    ):
        return None
    targets = initial_targets(
        sex=profile.sex,
        weight_kg=weight,
        height_cm=profile.height_cm,
        age=age_on(profile.birth_date, today),
        activity=profile.activity_level,
        goal=profile.goal,
        experience=profile.experience,
    )
    return NutritionTarget(
        user_id=user.id,
        effective_from=today,
        kcal=targets.kcal,
        protein_g=targets.protein_g,
        carbs_g=targets.carbs_g,
        fat_g=targets.fat_g,
        reason=TargetReason.INITIAL,
    )


async def targets_for(
    session: AsyncSession, user: User, day: date, today: date
) -> TargetsOut | None:
    """The targets in force on `day`, created from onboarding the first time they're asked
    for. None until onboarding has the data."""
    row = await _latest_target(session, user, day)
    if row is not None:
        return _targets_out(row)
    row = await _initial_row(session, user, today)
    if row is None:
        return None
    user_id = user.id
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        # Two first requests raced; the other one's row is the same computation.
        await session.rollback()
        await session.refresh(user)
        row = await _latest_target(session, user, day)
        assert row is not None, f"no targets for {user_id} after a unique violation"
    return _targets_out(row)


async def _today(session: AsyncSession, user: User, now: datetime) -> date:
    return local_day(now, ZoneInfo((await load_profile(session, user.id)).timezone))


async def get_targets(
    session: AsyncSession, user: User, day: date | None, now: datetime
) -> TargetsOut:
    today = await _today(session, user, now)
    targets = await targets_for(session, user, day or today, today)
    if targets is None:
        raise ConflictError(
            "profile_incomplete", "Finish onboarding to get calorie and macro targets"
        )
    return targets


async def minimum_kcal(session: AsyncSession, user: User, today: date) -> int:
    """The safety floor: max(BMR, 1200 / 1500), or 1200 before the profile can say more."""
    profile = await load_profile(session, user.id)
    weight = await latest_weight_kg(session, user.id)
    if (
        profile.sex is None
        or profile.birth_date is None
        or profile.height_cm is None
        or weight is None
    ):
        return FLOOR_KCAL[Sex.FEMALE]
    bmr = bmr_mifflin(profile.sex, weight, profile.height_cm, age_on(profile.birth_date, today))
    return kcal_floor(profile.sex, bmr)


async def write_targets(
    session: AsyncSession, user: User, today: date, values: dict[str, int], reason: TargetReason
) -> TargetsOut:
    """Targets in force from today; a second change on one day replaces the first."""
    row = await session.scalar(
        select(NutritionTarget).where(
            NutritionTarget.user_id == user.id, NutritionTarget.effective_from == today
        )
    )
    if row is None:
        row = NutritionTarget(user_id=user.id, effective_from=today, **values, reason=reason)
        session.add(row)
    else:
        for name, value in values.items():
            setattr(row, name, value)
        row.reason = reason
    await session.commit()
    return _targets_out(row)


async def set_targets(
    session: AsyncSession, user: User, body: TargetsIn, now: datetime
) -> TargetsOut:
    """The user's own targets from today. Below the safety floor is refused (CLAUDE.md §13)."""
    today = await _today(session, user, now)
    minimum = await minimum_kcal(session, user, today)
    if body.kcal < minimum:
        raise AppError(
            "target_below_safe_minimum",
            f"Daily calories can't go below {minimum} kcal.",
            422,
            {"minimum_kcal": minimum},
        )
    return await write_targets(session, user, today, body.model_dump(), TargetReason.MANUAL)


# --- the day ----------------------------------------------------------------------------


def totals(rows: Sequence[FoodLog]) -> NutritionTotals:
    return NutritionTotals(
        kcal=round_half_up(sum(r.kcal for r in rows), 1),
        protein_g=round_half_up(sum(r.protein_g for r in rows), 1),
        carbs_g=round_half_up(sum(r.carbs_g for r in rows), 1),
        fat_g=round_half_up(sum(r.fat_g for r in rows), 1),
        fiber_g=round_half_up(sum(r.fiber_g or 0 for r in rows), 1),
    )


async def nutrition_day(
    session: AsyncSession, user: User, day: date | None, now: datetime
) -> NutritionDay:
    today = await _today(session, user, now)
    wanted = day or today
    rows = await _day_logs(session, user, wanted)
    return NutritionDay(
        date=wanted,
        meals={meal: [log_out(r) for r in rows if r.meal == meal] for meal in Meal},
        totals=totals(rows),
        targets=await targets_for(session, user, wanted, today),
    )


# --- saved meals ------------------------------------------------------------------------


def saved_meal_tree() -> tuple[Any, ...]:
    return (selectinload(SavedMeal.items).joinedload(SavedMealItem.food),)


def saved_meal_out(meal: SavedMeal) -> SavedMealOut:
    return SavedMealOut(
        id=meal.id,
        name=meal.name,
        items=[
            SavedMealItemOut(
                food_id=item.food_id,
                name=item.food.name,
                source=item.food.source,
                quantity=item.quantity,
                unit=item.unit,
                grams=item.grams,
                per_100g=Per100gIn(
                    kcal=item.food.kcal_100g,
                    protein=item.food.protein_100g,
                    carbs=item.food.carbs_100g,
                    fat=item.food.fat_100g,
                    fiber=item.food.fiber_100g,
                ),
            )
            for item in meal.items
        ],
        version=meal.version,
        updated_at=meal.updated_at,
    )


async def _load_meal(session: AsyncSession, meal_id: uuid.UUID) -> SavedMeal | None:
    meal: SavedMeal | None = await session.scalar(
        select(SavedMeal)
        .where(SavedMeal.id == meal_id)
        .options(*saved_meal_tree())
        .execution_options(populate_existing=True)
    )
    return meal


async def _owned_meal(session: AsyncSession, user: User, meal_id: uuid.UUID) -> SavedMeal:
    meal = await _load_meal(session, meal_id)
    if meal is None or meal.user_id != user.id or meal.deleted_at is not None:
        raise NotFoundError("Saved meal not found")
    return meal


async def _check_items(session: AsyncSession, user: User, items: Sequence[SavedMealItemIn]) -> None:
    rows = await session.execute(
        select(Food.id, Food.owner_user_id).where(Food.id.in_({i.food_id for i in items}))
    )
    usable = {row.id for row in rows if row.owner_user_id in (None, user.id)}
    for index, item in enumerate(items):
        if item.food_id not in usable:
            raise AppError(
                "validation_error",
                "Request is invalid",
                422,
                [
                    {
                        "loc": ["body", "items", index, "food_id"],
                        "msg": "unknown food",
                        "type": "value_error",
                    }
                ],
            )


def _build_items(items: Sequence[SavedMealItemIn]) -> list[SavedMealItem]:
    return [
        SavedMealItem(
            position=index,
            food_id=item.food_id,
            quantity=round_half_up(item.quantity, 2),
            unit=item.unit,
            grams=round_half_up(item.grams, 2),
        )
        for index, item in enumerate(items)
    ]


def _items_key(items: Sequence[SavedMealItem]) -> list[tuple[Any, ...]]:
    return [(i.food_id, i.quantity, i.unit, i.grams) for i in items]


async def put_saved_meal(
    session: AsyncSession, user: User, meal_id: uuid.UUID, body: SavedMealIn
) -> SavedMealOut:
    """Create the saved meal, or set it to this state (the sync upsert)."""
    await lock_changes(session, user.id)
    await _check_items(session, user, body.items)
    replacement = _build_items(body.items)
    meal = await _load_meal(session, meal_id)
    if meal is None:
        session.add(SavedMeal(id=meal_id, user_id=user.id, name=body.name, items=replacement))
        await commit_new(session, "saved_meal_exists")
    else:
        await _replace_meal(session, meal, body.name, replacement)
    return saved_meal_out(await _owned_meal(session, user, meal_id))


async def _replace_meal(
    session: AsyncSession, meal: SavedMeal, name: str, replacement: list[SavedMealItem]
) -> None:
    same_items = _items_key(meal.items) == _items_key(replacement)
    if name == meal.name and same_items:
        return
    meal.name = name
    if not same_items:
        meal.items.clear()
        await session.flush()
        meal.items.extend(replacement)
    meal.version += 1
    await session.commit()


async def create_saved_meal(session: AsyncSession, user: User, body: SavedMealIn) -> SavedMealOut:
    await ensure_id_free(session, SavedMeal, body.id, "saved_meal_exists")
    return await put_saved_meal(session, user, body.id or uuid.uuid4(), body)


async def list_saved_meals(session: AsyncSession, user: User) -> list[SavedMealOut]:
    rows = await session.scalars(
        select(SavedMeal)
        .where(SavedMeal.user_id == user.id, SavedMeal.deleted_at.is_(None))
        .options(*saved_meal_tree())
        .order_by(SavedMeal.name, SavedMeal.id)
        .execution_options(populate_existing=True)
    )
    return [saved_meal_out(row) for row in rows]


async def get_saved_meal(session: AsyncSession, user: User, meal_id: uuid.UUID) -> SavedMealOut:
    return saved_meal_out(await _owned_meal(session, user, meal_id))


async def update_saved_meal(
    session: AsyncSession, user: User, meal_id: uuid.UUID, patch: SavedMealUpdate
) -> SavedMealOut:
    meal = await _owned_meal(session, user, meal_id)
    if patch.items is not None:
        await _check_items(session, user, patch.items)
        replacement = _build_items(patch.items)
    else:
        replacement = [
            SavedMealItem(
                position=i.position,
                food_id=i.food_id,
                quantity=i.quantity,
                unit=i.unit,
                grams=i.grams,
            )
            for i in meal.items
        ]
    await _replace_meal(session, meal, patch.name or meal.name, replacement)
    return saved_meal_out(await _owned_meal(session, user, meal_id))


async def delete_saved_meal(
    session: AsyncSession, user: User, meal_id: uuid.UUID, now: datetime
) -> None:
    meal = await _owned_meal(session, user, meal_id)
    meal.deleted_at = now
    meal.version += 1
    await session.commit()


async def log_saved_meal(
    session: AsyncSession, user: User, meal_id: uuid.UUID, body: SavedMealLog
) -> list[FoodLogOut]:
    """One log per item, with the foods' current values as their snapshots."""
    meal = await _owned_meal(session, user, meal_id)
    items = [(i.food_id, i.quantity, i.unit, i.grams) for i in meal.items]
    return [
        await put_log(
            session,
            user,
            uuid.uuid4(),
            FoodLogIn(
                log_date=body.log_date,
                meal=body.meal,
                food_id=food_id,
                quantity=quantity,
                unit=unit,
                grams=grams,
                source=LogSource.RECENT,
            ),
        )
        for food_id, quantity, unit, grams in items
    ]
