"""Words for the weekly report. The engine's numbers go in; the tips never change them. If the
LLM is off or fails, templates keep the card complete. Safety messages never depend on the LLM."""

import json
import logging
from dataclasses import asdict, dataclass, field

from app.ai.client import AiClient, AiError, AiRequest, load_prompt
from app.ai.schemas import MAX_EXPLANATION_CHARS, MAX_TIPS, OverloadExplanation, WeeklyTips
from app.db.models import OverloadRule
from app.services.nutrition_engine import WeekStatus

logger = logging.getLogger(__name__)

CHECK_IN_TIP = (
    "Your intake or weight has dropped quickly. Please consider talking to a doctor or "
    "dietitian before cutting any further."
)
FLOOR_TIP = (
    "Your calories are already at the safe minimum, so slowing down is better than cutting more."
)
HEADLINES = {
    WeekStatus.ON_TRACK: "You're on track this week.",
    WeekStatus.TOO_FAST: "Your weight moved faster than planned this week.",
    WeekStatus.TOO_SLOW: "Your weight moved slower than planned this week.",
    WeekStatus.INSUFFICIENT_DATA: "Log more weigh-ins to get your weekly report.",
}
TEMPLATE_TIPS = {
    WeekStatus.ON_TRACK: [
        "Keep your calories and protein where they are.",
        "Weigh in at the same time each morning so the trend stays reliable.",
    ],
    WeekStatus.TOO_FAST: [
        "Check the new targets below; they adjust your calories a little.",
        "Keep protein high and spread it across your meals.",
    ],
    WeekStatus.TOO_SLOW: [
        "Check the new targets below; they adjust your calories a little.",
        "Log your weekend meals too, since they often explain a slow week.",
    ],
    WeekStatus.INSUFFICIENT_DATA: [
        "A weekly average needs at least 3 weigh-ins in each of two weeks.",
        "Weigh in on three mornings this week and the report will fill in.",
    ],
}


@dataclass(frozen=True)
class WeekFacts:
    """Everything the LLM sees: numbers and categories, nothing that identifies the user."""

    goal: str
    experience: str
    weekly_avg: float | None
    prev_avg: float | None
    rate_pct: float | None
    target_rate_range: tuple[float, float]
    status: WeekStatus
    old_targets: dict[str, int] | None
    new_targets: dict[str, int] | None
    avg_protein_g: float | None
    avg_kcal_logged: float | None
    days_logged: int
    workouts_this_week: int
    check_in: bool
    floor_hit: bool
    # How this week's lifts progressed: coach rule → exercises.
    lift_progress: dict[str, int] = field(default_factory=dict)


def with_safety(tips: WeeklyTips, facts: WeekFacts) -> WeeklyTips:
    """The required messages go first, whoever wrote the rest."""
    required = [CHECK_IN_TIP] * facts.check_in + [FLOOR_TIP] * facts.floor_hit
    return WeeklyTips(headline=tips.headline, tips=[*required, *tips.tips][:MAX_TIPS])


def template_tips(facts: WeekFacts) -> WeeklyTips:
    return with_safety(
        WeeklyTips(headline=HEADLINES[facts.status], tips=TEMPLATE_TIPS[facts.status]), facts
    )


async def weekly_tips(ai: AiClient, facts: WeekFacts) -> tuple[WeeklyTips, bool]:
    """The tips, and whether the LLM wrote them. A week without data has nothing to discuss."""
    if facts.status == WeekStatus.INSUFFICIENT_DATA:
        return template_tips(facts), False
    try:
        tips = await ai.complete(
            AiRequest(
                "weekly_tips",
                WeeklyTips,
                load_prompt("weekly_tips"),
                [{"type": "text", "text": json.dumps(asdict(facts))}],
            )
        )
    except AiError as exc:
        logger.info("weekly_tips_fallback", extra={"reason": exc.code})
        return template_tips(facts), False
    return with_safety(tips, facts), True


OVERLOAD_TEMPLATES = {
    OverloadRule.INCREASE_WEIGHT: "You hit the top of the range with reps to spare, so add weight.",
    OverloadRule.ADD_REPS: "Keep the weight and add a rep to your weakest set.",
    OverloadRule.REDUCE_WEIGHT: "You've been under the rep range twice, so lighten the load.",
    OverloadRule.DELOAD: "Your estimated 1RM has stalled, so take a lighter week to recover.",
    OverloadRule.SWAP: "You've stalled even after a deload, so try a variation of this lift.",
}


@dataclass(frozen=True)
class OverloadFacts:
    exercise: str
    rule: OverloadRule
    rep_range: tuple[int, int]
    # Newest first, up to three sessions of (weight, reps, RPE).
    last_sessions: list[list[dict[str, float | None]]]
    target_sets: list[dict[str, float | None]]


async def explain_overload(ai: AiClient, facts: OverloadFacts) -> str:
    """One sentence on why. The rule and the target are already decided."""
    try:
        answer = await ai.complete(
            AiRequest(
                "overload_explain",
                OverloadExplanation,
                load_prompt("overload_explain"),
                [{"type": "text", "text": json.dumps(asdict(facts))}],
            )
        )
    except AiError as exc:
        logger.info("overload_explain_fallback", extra={"reason": exc.code})
        return OVERLOAD_TEMPLATES[facts.rule]
    return answer.explanation[:MAX_EXPLANATION_CHARS]
