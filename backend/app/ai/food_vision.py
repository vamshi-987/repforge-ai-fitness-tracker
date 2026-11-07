"""Turns a photo or a description into a draft the user confirms. The model perceives what and
how much; the numbers come from the food database whenever a food matches."""

import base64

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AiClient, AiRequest, load_prompt
from app.ai.schemas import FoodEstimate, FoodItem
from app.db.models import User
from app.schemas.nutrition import DraftItem, FoodDraft, Per100gIn
from app.services.food_search import closest_food
from app.services.macros import Per100g, log_amounts

MAX_KCAL_100G = 900
MAX_GRAMS_100G = 100


async def estimate_photo(ai: AiClient, image: bytes, media_type: str) -> FoodEstimate:
    source = {
        "type": "base64",
        "media_type": media_type,
        "data": base64.standard_b64encode(image).decode("ascii"),
    }
    return await ai.complete(
        AiRequest(
            "food_photo",
            FoodEstimate,
            load_prompt("food_photo"),
            [
                {"type": "image", "source": source},
                {"type": "text", "text": "List the foods in this photo."},
            ],
            effort="medium",
        )
    )


async def estimate_text(ai: AiClient, text: str) -> FoodEstimate:
    return await ai.complete(
        AiRequest(
            "food_text",
            FoodEstimate,
            load_prompt("food_text"),
            [{"type": "text", "text": text}],
        )
    )


def _estimated_per_100g(item: FoodItem) -> Per100g:
    """The model's portion numbers as per-100 g values, within what 100 g can hold, so the
    draft scales when the user changes the grams."""

    def per_100(amount: float, limit: int) -> float:
        return min(round(amount * 100 / item.estimated_grams, 2), limit)

    return Per100g(
        kcal=per_100(item.kcal, MAX_KCAL_100G),
        protein=per_100(item.protein_g, MAX_GRAMS_100G),
        carbs=per_100(item.carbs_g, MAX_GRAMS_100G),
        fat=per_100(item.fat_g, MAX_GRAMS_100G),
    )


async def _draft_item(session: AsyncSession, user: User, item: FoodItem) -> DraftItem:
    food = await closest_food(session, user, item.match_query)
    if food is None:
        per_100g = _estimated_per_100g(item)
    else:
        per_100g = Per100g(
            food.kcal_100g, food.protein_100g, food.carbs_100g, food.fat_100g, food.fiber_100g
        )
    amounts = log_amounts(per_100g, item.estimated_grams)
    return DraftItem(
        name=food.name if food else item.name,
        food_id=food.id if food else None,
        grams=item.estimated_grams,
        per_100g=Per100gIn(
            kcal=per_100g.kcal,
            protein=per_100g.protein,
            carbs=per_100g.carbs,
            fat=per_100g.fat,
            fiber=per_100g.fiber,
        ),
        kcal=amounts.kcal,
        protein_g=amounts.protein_g,
        carbs_g=amounts.carbs_g,
        fat_g=amounts.fat_g,
        fiber_g=amounts.fiber_g,
        confidence=item.confidence,
    )


async def to_draft(session: AsyncSession, user: User, estimate: FoodEstimate) -> FoodDraft:
    return FoodDraft(
        items=[await _draft_item(session, user, item) for item in estimate.items],
        notes=estimate.notes,
    )
