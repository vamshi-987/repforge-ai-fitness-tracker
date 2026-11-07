import pytest

from app.db.models import ActivityLevel, Experience, Goal, Sex
from app.services.macros import MacroOverride, Per100g, kcal_from_macros, log_amounts, scale
from app.services.nutrition_engine import (
    bmr_mifflin,
    initial_targets,
    kcal_floor,
    macro_split,
    round50,
    tdee,
)

DAL = Per100g(kcal=145, protein=8.6, carbs=19.17, fat=4.31, fiber=7.5)


# --- macros -----------------------------------------------------------------------------


def test_kcal_and_scaling() -> None:
    assert kcal_from_macros(10, 20, 5) == 165
    assert scale(145, 250) == 362.5


def test_a_log_scales_the_snapshot() -> None:
    amounts = log_amounts(DAL, 250)
    assert (amounts.kcal, amounts.protein_g, amounts.carbs_g, amounts.fat_g, amounts.fiber_g) == (
        362.5,
        21.5,
        47.9,
        10.8,
        18.8,
    )
    assert (amounts.macros_overridden, amounts.kcal_overridden) == (False, False)


def test_edited_macros_recompute_kcal() -> None:
    amounts = log_amounts(DAL, 250, MacroOverride(protein_g=30, carbs_g=47.9, fat_g=10.8))
    # 4*30 + 4*47.9 + 9*10.8
    assert amounts.kcal == 408.8
    assert amounts.fiber_g is None
    assert amounts.macros_overridden and not amounts.kcal_overridden


def test_an_explicit_kcal_wins() -> None:
    amounts = log_amounts(DAL, 250, MacroOverride(30, 48, 11), kcal=400)
    assert (amounts.kcal, amounts.kcal_overridden) == (400, True)
    assert log_amounts(Per100g(0, 0, 0, 0), 100, kcal=55).kcal == 55


# --- energy and targets -----------------------------------------------------------------


def test_bmr_mifflin() -> None:
    assert bmr_mifflin(Sex.MALE, 80, 180, 30) == 1780  # 800 + 1125 - 150 + 5
    assert bmr_mifflin(Sex.FEMALE, 60, 165, 30) == 1320.25  # 600 + 1031.25 - 150 - 161


@pytest.mark.parametrize(
    ("activity", "factor"),
    [
        (ActivityLevel.SEDENTARY, 1.2),
        (ActivityLevel.MODERATE, 1.55),
        (ActivityLevel.VERY_ACTIVE, 1.9),
    ],
)
def test_tdee(activity: ActivityLevel, factor: float) -> None:
    assert tdee(1000, activity) == pytest.approx(1000 * factor)


def test_round50_and_floor() -> None:
    assert (round50(2124), round50(2126), round50(-60)) == (2100, 2150, -50)
    assert kcal_floor(Sex.MALE, 1420) == 1500
    assert kcal_floor(Sex.FEMALE, 1320) == 1300
    assert kcal_floor(Sex.FEMALE, 1100) == 1200


def test_macro_split() -> None:
    assert macro_split(2800, 80) == (144, 380, 78)  # fat 25 % = 77.8 g > 0.6 g/kg
    # Fat never drops below 0.6 g/kg; carbs never negative.
    assert macro_split(1200, 120) == (216, 0, 72)


@pytest.mark.parametrize(
    ("goal", "experience", "kcal"),
    [
        # TDEE 1780 * 1.55 = 2759; +0.5 % of 80 kg/week = +440 kcal/day.
        (Goal.MUSCLE_GAIN, Experience.BEGINNER, 3200),
        (Goal.MUSCLE_GAIN, Experience.ADVANCED, 3000),  # +220 kcal: 2979 rounds to 3000
        (Goal.MAINTAIN, Experience.INTERMEDIATE, 2750),
        # -0.75 %/week = -660 kcal/day.
        (Goal.FAT_LOSS, Experience.BEGINNER, 2100),
    ],
)
def test_initial_targets(goal: Goal, experience: Experience, kcal: int) -> None:
    targets = initial_targets(
        sex=Sex.MALE,
        weight_kg=80,
        height_cm=180,
        age=30,
        activity=ActivityLevel.MODERATE,
        goal=goal,
        experience=experience,
    )
    assert targets.kcal == kcal
    assert (targets.bmr, targets.tdee, targets.protein_g, targets.floored) == (
        1780,
        2759,
        144,
        False,
    )
    assert 4 * targets.protein_g + 4 * targets.carbs_g + 9 * targets.fat_g == pytest.approx(
        kcal, abs=6
    )


def test_targets_never_go_below_the_safe_floor() -> None:
    targets = initial_targets(
        sex=Sex.FEMALE,
        weight_kg=45,
        height_cm=150,
        age=60,
        activity=ActivityLevel.SEDENTARY,
        goal=Goal.FAT_LOSS,
        experience=Experience.BEGINNER,
    )
    assert (targets.kcal, targets.floored) == (1200, True)
