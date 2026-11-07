"""Finding foods: the user's own and the shared library first, then USDA FoodData Central, then
Open Food Facts. Remote results are normalised to per-100 g values and saved to the library,
so the next search (anyone's) finds them locally and logs can point at them.

Redis remembers which foods a query returned for 7 days (`foodsearch:{source}:{query}`), and a
barcode Open Food Facts doesn't know for 1 day (`off:barcode:{code}`). Remote trouble (timeout,
rate limit, bad response) never fails a search: the local results come back with
`partial: true`.
"""

import hashlib
import json
import logging
import re
import uuid
from collections.abc import Sequence
from dataclasses import replace
from typing import Any

import httpx
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import ColumnElement, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cache.redis import get_text
from app.config import Settings
from app.core.errors import AppError, NotFoundError
from app.db.models import Food, FoodSource, User
from app.schemas.foods import FoodOut, FoodSearchOut, ServingOut
from app.services.exercise_search import escape_like
from app.services.food_library import LibraryFood, Serving, upsert_foods

logger = logging.getLogger(__name__)

USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
# Open Food Facts asks every client to identify itself.
USER_AGENT = "RepForge/0.1 (https://github.com/vamshi-987/repforge-ai-fitness-tracker)"
SEARCH_TTL_S = 7 * 24 * 3600
MISSING_BARCODE_TTL_S = 24 * 3600
REMOTE_PAGE = 15
# Below this many local matches, ask the online sources too.
ENOUGH_LOCAL = 8
KJ_PER_KCAL = 4.184
# How alike two names must be (pg_trgm) to count as the same food.
MATCH_THRESHOLD = 0.5
# Pure fat, the densest food there is.
MAX_KCAL_100G = 900
BARCODE = re.compile(r"^\d{8,14}$")
OFF_FIELDS = "code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity"


# --- pure helpers -----------------------------------------------------------------------


def normalize_query(raw: str) -> str:
    return " ".join(raw.lower().split())[:100]


def tidy_name(name: str) -> str:
    """USDA branded names are often SHOUTED; make them readable."""
    name = " ".join(name.split())
    return name.title() if name.isupper() else name


def _number(value: Any) -> float | None:
    try:
        return None if value is None or value == "" else float(value)
    except (TypeError, ValueError):
        return None


def _plausible(food: LibraryFood) -> LibraryFood | None:
    """Online sources hold typos (kJ in the kcal field, values per pack). A food outside what
    100 g can hold is dropped: a log of it could never be saved."""
    macros = (food.protein_100g, food.carbs_100g, food.fat_100g)
    if not 0 <= food.kcal_100g <= MAX_KCAL_100G or any(not 0 <= m <= 100 for m in macros):
        return None
    if food.fiber_100g is not None and not 0 <= food.fiber_100g <= 100:
        return replace(food, fiber_100g=None)
    return food


def usda_food(item: dict[str, Any]) -> LibraryFood | None:
    """One FDC search hit → a food, or None when it lacks energy or the three macros.
    FDC reports search nutrients per 100 g for every data type."""
    by_number: dict[str, float] = {}
    for nutrient in item.get("foodNutrients", []):
        value = _number(nutrient.get("value"))
        number = str(nutrient.get("nutrientNumber", ""))
        if value is not None and number:
            by_number.setdefault(number, value)
    kcal = by_number.get("208") or by_number.get("958") or by_number.get("957")
    if kcal is None and "268" in by_number:
        kcal = by_number["268"] / KJ_PER_KCAL
    macros = [by_number.get(n) for n in ("203", "205", "204")]
    if kcal is None or any(m is None for m in macros):
        return None
    protein, carbs, fat = (m or 0.0 for m in macros)
    servings: tuple[Serving, ...] = ()
    size = _number(item.get("servingSize"))
    if size and str(item.get("servingSizeUnit", "")).lower() in ("g", "grm", "ml", "mlt"):
        label = item.get("householdServingFullText") or f"{size:g} g"
        servings = (Serving(str(label), size),)
    brand = item.get("brandName") or item.get("brandOwner")
    return _plausible(
        LibraryFood(
            external_id=str(item["fdcId"]),
            name=tidy_name(str(item.get("description", ""))),
            brand=tidy_name(str(brand)) if brand else None,
            barcode=item.get("gtinUpc") or None,
            kcal_100g=kcal,
            protein_100g=protein,
            carbs_100g=carbs,
            fat_100g=fat,
            fiber_100g=by_number.get("291"),
            servings=servings,
        )
    )


def off_food(product: dict[str, Any]) -> LibraryFood | None:
    """One Open Food Facts product → a food, or None without a name or nutrition facts."""
    n = product.get("nutriments") or {}
    kcal = _number(n.get("energy-kcal_100g"))
    if kcal is None and _number(n.get("energy_100g")) is not None:
        kcal = (_number(n.get("energy_100g")) or 0.0) / KJ_PER_KCAL
    protein, carbs, fat = (
        _number(n.get(key)) for key in ("proteins_100g", "carbohydrates_100g", "fat_100g")
    )
    name = (product.get("product_name") or product.get("product_name_en") or "").strip()
    code = str(product.get("code") or "").strip()
    if not name or not code or kcal is None or None in (protein, carbs, fat):
        return None
    servings: tuple[Serving, ...] = ()
    grams = _number(product.get("serving_quantity"))
    if grams and grams > 0:
        servings = (Serving(str(product.get("serving_size") or f"{grams:g} g"), grams),)
    brand = str(product.get("brands") or "").split(",")[0].strip() or None
    return _plausible(
        LibraryFood(
            external_id=code,
            name=name,
            brand=brand,
            barcode=code,
            kcal_100g=kcal,
            protein_100g=protein or 0.0,
            carbs_100g=carbs or 0.0,
            fat_100g=fat or 0.0,
            fiber_100g=_number(n.get("fiber_100g")),
            servings=servings,
        )
    )


def food_out(food: Food) -> FoodOut:
    return FoodOut(
        id=food.id,
        name=food.name,
        brand=food.brand,
        source=food.source,
        barcode=food.barcode,
        kcal_100g=food.kcal_100g,
        protein_100g=food.protein_100g,
        carbs_100g=food.carbs_100g,
        fat_100g=food.fat_100g,
        fiber_100g=food.fiber_100g,
        servings=[ServingOut(label=s.label, grams=s.grams) for s in food.servings],
        is_custom=food.owner_user_id is not None,
        version=food.version,
        updated_at=food.updated_at,
    )


# --- cache (fails open) ---------------------------------------------------------------


async def _cache_get(redis: Redis, key: str) -> str | None:
    try:
        return await get_text(redis, key)
    except RedisError as exc:
        logger.warning("cache_unavailable", extra={"key": key, "error": repr(exc)})
        return None


async def _cache_set(redis: Redis, key: str, value: str, ttl_s: int) -> None:
    try:
        await redis.set(key, value, ex=ttl_s)
    except RedisError as exc:
        logger.warning("cache_unavailable", extra={"key": key, "error": repr(exc)})


def _query_key(source: str, query: str) -> str:
    return f"foodsearch:{source}:{hashlib.sha256(query.encode()).hexdigest()[:24]}"


# --- local ------------------------------------------------------------------------------


def _visible(user: User) -> ColumnElement[bool]:
    return and_(
        or_(Food.owner_user_id.is_(None), Food.owner_user_id == user.id),
        Food.deleted_at.is_(None),
    )


async def _load(session: AsyncSession, ids: Sequence[uuid.UUID], user: User) -> list[Food]:
    """Foods by id, in the given order (hidden or missing ones dropped)."""
    rows = {
        row.id: row
        for row in await session.scalars(
            select(Food)
            .where(Food.id.in_(ids), _visible(user))
            .options(selectinload(Food.servings))
        )
    }
    return [rows[i] for i in ids if i in rows]


async def _local(session: AsyncSession, user: User, query: str, limit: int) -> list[Food]:
    tokens = query.split()
    contains_all = and_(*(Food.name.ilike(f"%{escape_like(t)}%", escape="\\") for t in tokens))
    prefix = func.lower(Food.name).like(f"{escape_like(query)}%", escape="\\")
    score = case((prefix, 2.0), (contains_all, 1.0), else_=0.0) + func.word_similarity(
        query, Food.name
    )
    mine = case((Food.owner_user_id.is_(None), 0), else_=1)
    rows = await session.scalars(
        select(Food)
        .where(_visible(user), or_(contains_all, Food.name.op("%>")(query)))
        .options(selectinload(Food.servings))
        # The user's own foods first, then the best matches.
        .order_by(mine.desc(), score.desc(), func.length(Food.name), Food.id)
        .limit(limit)
    )
    return list(rows)


async def closest_food(session: AsyncSession, user: User, query: str) -> Food | None:
    """The food a name clearly means, or None. Strict on purpose: a wrong match would put the
    wrong numbers on a draft, where the model's own estimate is the better guess."""
    wanted = normalize_query(query)
    closeness = func.similarity(func.lower(Food.name), wanted)
    mine = case((Food.owner_user_id.is_(None), 0), else_=1)
    found: Food | None = await session.scalar(
        select(Food)
        .where(_visible(user), closeness >= MATCH_THRESHOLD)
        .order_by(closeness.desc(), mine.desc(), Food.id)
        .limit(1)
    )
    return found


# --- remote -----------------------------------------------------------------------------


class RemoteError(Exception):
    pass


async def _get_json(
    http: httpx.AsyncClient,
    url: str,
    params: dict[str, Any],
    body: dict[str, Any] | None = None,
) -> Any:
    """GET, or POST `body` as JSON. Any transport, status or parsing problem is a RemoteError."""
    try:
        headers = {"User-Agent": USER_AGENT}
        response = (
            await http.post(url, params=params, json=body, headers=headers)
            if body is not None
            else await http.get(url, params=params, headers=headers)
        )
    except httpx.HTTPError as exc:
        raise RemoteError(repr(exc)) from exc
    if response.status_code != 200:
        raise RemoteError(f"{url} answered {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise RemoteError(f"{url} sent no JSON") from exc


async def _remote_search(
    session: AsyncSession,
    redis: Redis,
    http: httpx.AsyncClient,
    settings: Settings,
    source: FoodSource,
    query: str,
    user: User,
) -> list[Food]:
    """Foods the source has for the query (cached ids, or fetched, normalised and saved)."""
    key = _query_key(source.value, query)
    cached = await _cache_get(redis, key)
    if cached is not None:
        return await _load(session, [uuid.UUID(i) for i in json.loads(cached)], user)
    if source == FoodSource.USDA:
        # POST: as a GET query, httpx's "+" for spaces makes FDC reject "Survey (FNDDS)".
        body = await _get_json(
            http,
            USDA_SEARCH_URL,
            {"api_key": settings.usda_fdc_api_key or "DEMO_KEY"},
            {
                "query": query,
                "pageSize": REMOTE_PAGE,
                "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"],
            },
        )
        found = [usda_food(item) for item in (body or {}).get("foods", [])]
    else:
        body = await _get_json(
            http,
            OFF_SEARCH_URL,
            {
                "search_terms": query,
                "json": 1,
                "page_size": REMOTE_PAGE,
                "fields": OFF_FIELDS,
            },
        )
        found = [off_food(p) for p in (body or {}).get("products", [])]
    foods = [f for f in found if f is not None]
    _, rows = await upsert_foods(session, source, foods)
    await session.commit()
    ids = list(dict.fromkeys(row.id for row in rows))
    await _cache_set(redis, key, json.dumps([str(i) for i in ids]), SEARCH_TTL_S)
    return await _load(session, ids, user)


async def search_foods(
    session: AsyncSession,
    redis: Redis,
    http: httpx.AsyncClient,
    settings: Settings,
    user: User,
    raw_query: str,
    limit: int,
) -> FoodSearchOut:
    query = normalize_query(raw_query)
    if len(query) < 2:
        return FoodSearchOut(items=[], partial=False)
    results = await _local(session, user, query, limit)
    partial = False
    for source in (FoodSource.USDA, FoodSource.OFF):
        if len(results) >= ENOUGH_LOCAL:
            break
        try:
            remote = await _remote_search(session, redis, http, settings, source, query, user)
        except RemoteError as exc:
            logger.warning("food_source_unavailable", extra={"source": source, "error": str(exc)})
            partial = True
            continue
        seen = {f.id for f in results}
        results += [f for f in remote if f.id not in seen]
    return FoodSearchOut(items=[food_out(f) for f in results[:limit]], partial=partial)


async def food_by_barcode(
    session: AsyncSession, redis: Redis, http: httpx.AsyncClient, user: User, code: str
) -> FoodOut:
    if not BARCODE.match(code):
        raise AppError(
            "validation_error",
            "Request is invalid",
            422,
            [{"loc": ["path", "code"], "msg": "a barcode is 8-14 digits", "type": "value_error"}],
        )
    local = await session.scalar(
        select(Food)
        .where(Food.barcode == code, _visible(user))
        .options(selectinload(Food.servings))
        .order_by(Food.owner_user_id.is_(None), Food.updated_at.desc())
        .limit(1)
    )
    if local is not None:
        return food_out(local)
    missing_key = f"off:barcode:{code}"
    if await _cache_get(redis, missing_key) is not None:
        raise NotFoundError("No food with this barcode")
    try:
        body = await _get_json(
            http,
            OFF_PRODUCT_URL.format(code=code),
            {"fields": OFF_FIELDS},
        )
    except RemoteError as exc:
        raise AppError(
            "food_source_unavailable", "Couldn't reach Open Food Facts. Try again.", 503
        ) from exc
    product = body.get("product") if isinstance(body, dict) and body.get("status") == 1 else None
    food = off_food({**product, "code": code}) if product else None
    if food is None:
        await _cache_set(redis, missing_key, "1", MISSING_BARCODE_TTL_S)
        raise NotFoundError("No food with this barcode")
    _, (row,) = await upsert_foods(session, FoodSource.OFF, [food])
    await session.commit()
    (loaded,) = await _load(session, [row.id], user)
    return food_out(loaded)


async def get_food(session: AsyncSession, user: User, food_id: uuid.UUID) -> FoodOut:
    rows = await _load(session, [food_id], user)
    if not rows:
        raise NotFoundError("Food not found")
    return food_out(rows[0])
