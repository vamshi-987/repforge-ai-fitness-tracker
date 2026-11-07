"""Energy needs, daily targets and the weekly adjustment, all deterministic (CLAUDE.md §4.2 A and
§10). The LLM never sets a number here: it only writes words about these results."""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from app.db.models import ActivityLevel, Experience, Goal, Sex

KCAL_PER_KG = 7700
ACTIVITY_FACTORS: dict[ActivityLevel, float] = {
    ActivityLevel.SEDENTARY: 1.2,
    ActivityLevel.LIGHT: 1.375,
    ActivityLevel.MODERATE: 1.55,
    ActivityLevel.ACTIVE: 1.725,
    ActivityLevel.VERY_ACTIVE: 1.9,
}
# Weekly change aimed for at the start, as % of body weight (inside CLAUDE.md's ranges:
# gain +0.25 to +0.5 %, loss -0.5 to -1.0 %).
INITIAL_RATE_PCT: dict[tuple[Goal, Experience], float] = {
    (Goal.MUSCLE_GAIN, Experience.BEGINNER): 0.5,
    (Goal.MUSCLE_GAIN, Experience.INTERMEDIATE): 0.375,
    (Goal.MUSCLE_GAIN, Experience.ADVANCED): 0.25,
    **{(Goal.FAT_LOSS, e): -0.75 for e in Experience},
    **{(Goal.MAINTAIN, e): 0.0 for e in Experience},
}
PROTEIN_G_PER_KG = 1.8
MIN_FAT_G_PER_KG = 0.6
FAT_SHARE = 0.25
FLOOR_KCAL: dict[Sex, int] = {Sex.FEMALE: 1200, Sex.MALE: 1500}


def round50(value: float) -> int:
    return int(round(value / 50) * 50)


def bmr_mifflin(sex: Sex, weight_kg: float, height_cm: float, age: int) -> float:
    """Mifflin-St Jeor: 10*kg + 6.25*cm - 5*age + 5 (male) or - 161 (female)."""
    return 10 * weight_kg + 6.25 * height_cm - 5 * age + (5 if sex == Sex.MALE else -161)


def tdee(bmr: float, activity: ActivityLevel) -> float:
    return bmr * ACTIVITY_FACTORS[activity]


def kcal_floor(sex: Sex, bmr: float) -> int:
    """No target goes below max(BMR, 1200 for women / 1500 for men) (CLAUDE.md §13)."""
    return max(round50(bmr), FLOOR_KCAL[sex])


@dataclass(frozen=True)
class Targets:
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    bmr: int
    tdee: int
    # The safety floor raised the calories above what the goal asked for.
    floored: bool


def macro_split(kcal: int, weight_kg: float) -> tuple[int, int, int]:
    """Protein 1.8 g/kg, fat 25 % of calories but at least 0.6 g/kg, carbs the rest."""
    protein = round(PROTEIN_G_PER_KG * weight_kg)
    fat = round(max(MIN_FAT_G_PER_KG * weight_kg, FAT_SHARE * kcal / 9))
    carbs = max(0, round((kcal - 4 * protein - 9 * fat) / 4))
    return protein, carbs, fat


def initial_targets(
    *,
    sex: Sex,
    weight_kg: float,
    height_cm: float,
    age: int,
    activity: ActivityLevel,
    goal: Goal,
    experience: Experience,
) -> Targets:
    bmr = bmr_mifflin(sex, weight_kg, height_cm, age)
    energy = tdee(bmr, activity)
    rate_kg = INITIAL_RATE_PCT[(goal, experience)] / 100 * weight_kg
    wanted = round50(energy + rate_kg * KCAL_PER_KG / 7)
    floor = kcal_floor(sex, bmr)
    kcal = max(wanted, floor)
    protein, carbs, fat = macro_split(kcal, weight_kg)
    return Targets(kcal, protein, carbs, fat, round(bmr), round(energy), kcal > wanted)


# --- the weekly adjustment ------------------------------------------------------------------

# Weekly change that counts as on track, % of body weight (CLAUDE.md §4.2 A). The point aimed
# for inside the range is INITIAL_RATE_PCT, which depends on experience.
RATE_RANGE_PCT: dict[Goal, tuple[float, float]] = {
    Goal.MUSCLE_GAIN: (0.25, 0.5),
    Goal.FAT_LOSS: (-1.0, -0.5),
    Goal.MAINTAIN: (-0.2, 0.2),
}
MAX_WEEKLY_DELTA_KCAL = 300
# The two weekly averages sit a week apart, however many days they cover.
DAYS_BETWEEN_AVERAGES = 7
ADAPTIVE_WINDOW_DAYS = 14
ADAPTIVE_MIN_LOGGED_DAYS = 12  # 80 % of 14
# When to stop suggesting cuts and suggest a professional instead (CLAUDE.md §13).
CHECK_IN_KCAL = 1000
CHECK_IN_DAYS = 7
CHECK_IN_LOSS_PCT = -1.5


class WeekStatus(StrEnum):
    ON_TRACK = "on_track"
    TOO_FAST = "too_fast"
    TOO_SLOW = "too_slow"
    INSUFFICIENT_DATA = "insufficient_data"


def rate_pct(average_kg: float, previous_kg: float) -> float:
    # Rounded past any real precision, so float noise can't tip 0.125 down when it's displayed.
    return round((average_kg - previous_kg) / previous_kg * 100, 8)


def week_status(goal: Goal, rate: float) -> WeekStatus:
    low, high = RATE_RANGE_PCT[goal]
    if low <= rate <= high:
        return WeekStatus.ON_TRACK
    if goal == Goal.MAINTAIN:
        return WeekStatus.TOO_FAST
    # For fat loss "fast" is further below zero; for gaining, further above.
    too_far = rate < low if goal == Goal.FAT_LOSS else rate > high
    return WeekStatus.TOO_FAST if too_far else WeekStatus.TOO_SLOW


def delta_kcal(target_kg: float, actual_kg: float) -> int:
    """round50(clamp((target - actual) * 7700 / 7, -300, +300))."""
    raw = (target_kg - actual_kg) * KCAL_PER_KG / 7
    return round50(max(-MAX_WEEKLY_DELTA_KCAL, min(MAX_WEEKLY_DELTA_KCAL, raw)))


def adaptive_tdee(daily_kcal: Sequence[float], change_kg: float) -> int | None:
    """What the body actually burned: intake minus what went into or came out of body weight.
    Only trusted with 12 of the last 14 days logged."""
    if len(daily_kcal) < ADAPTIVE_MIN_LOGGED_DAYS:
        return None
    average = sum(daily_kcal) / len(daily_kcal)
    return round(average - change_kg * KCAL_PER_KG / DAYS_BETWEEN_AVERAGES)


def needs_check_in(
    week_kcal: Sequence[float], rate: float | None, previous_rate: float | None
) -> bool:
    """Seven logged days under 1000 kcal, or two weeks losing more than 1.5 % each."""
    eating_little = len(week_kcal) >= CHECK_IN_DAYS and all(k < CHECK_IN_KCAL for k in week_kcal)
    losing_fast = (
        rate is not None
        and previous_rate is not None
        and rate < CHECK_IN_LOSS_PCT
        and previous_rate < CHECK_IN_LOSS_PCT
    )
    return eating_little or losing_fast


@dataclass(frozen=True)
class DailyTargets:
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int


@dataclass(frozen=True)
class WeekInput:
    goal: Goal
    experience: Experience
    average_kg: float
    previous_kg: float
    current: DailyTargets
    # max(BMR, 1200 / 1500).
    floor_kcal: int
    check_in: bool


@dataclass(frozen=True)
class WeekResult:
    status: WeekStatus
    change_kg: float
    rate_pct: float
    delta_kcal: int
    targets: DailyTargets
    # The floor stopped the calories going as low as the numbers asked for.
    floor_hit: bool


def weekly_adjustment(week: WeekInput) -> WeekResult:
    """On track changes nothing. Otherwise calories move towards the rate aimed for, at most
    300 a day, never below the floor, and never down at all during a check-in."""
    change = week.average_kg - week.previous_kg
    rate = rate_pct(week.average_kg, week.previous_kg)
    status = week_status(week.goal, rate)
    target_kg = week.previous_kg * INITIAL_RATE_PCT[(week.goal, week.experience)] / 100
    delta = 0 if status == WeekStatus.ON_TRACK else delta_kcal(target_kg, change)
    if week.check_in:
        delta = max(delta, 0)
    wanted = week.current.kcal + delta
    kcal = max(wanted, week.floor_kcal)
    delta = kcal - week.current.kcal
    if delta == 0:
        targets = week.current
    else:
        protein, carbs, fat = macro_split(kcal, week.average_kg)
        targets = DailyTargets(kcal, protein, carbs, fat)
    return WeekResult(status, change, rate, delta, targets, floor_hit=wanted < week.floor_kcal)
