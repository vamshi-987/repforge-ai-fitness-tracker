"""The weekly adjustment, by hand (CLAUDE.md §4.2 A and §10)."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.ai.coach_tips import CHECK_IN_TIP, FLOOR_TIP, WeekFacts, template_tips, with_safety
from app.ai.schemas import WeeklyTips
from app.db.models import Experience, Goal
from app.services.coach import is_report_hour, last_full_week
from app.services.nutrition_engine import (
    DailyTargets,
    WeekInput,
    WeekStatus,
    adaptive_tdee,
    delta_kcal,
    needs_check_in,
    rate_pct,
    week_status,
    weekly_adjustment,
)

CURRENT = DailyTargets(kcal=2800, protein_g=144, carbs_g=350, fat_g=78)


def week(**overrides: object) -> WeekInput:
    values: dict[str, object] = {
        "goal": Goal.MUSCLE_GAIN,
        "experience": Experience.INTERMEDIATE,
        "average_kg": 80.1,
        "previous_kg": 80.0,
        "current": CURRENT,
        "floor_kcal": 1800,
        "check_in": False,
        **overrides,
    }
    return WeekInput(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("goal", "rate", "status"),
    [
        (Goal.MUSCLE_GAIN, 0.25, WeekStatus.ON_TRACK),
        (Goal.MUSCLE_GAIN, 0.5, WeekStatus.ON_TRACK),
        (Goal.MUSCLE_GAIN, 0.1, WeekStatus.TOO_SLOW),
        (Goal.MUSCLE_GAIN, -0.3, WeekStatus.TOO_SLOW),
        (Goal.MUSCLE_GAIN, 0.8, WeekStatus.TOO_FAST),
        (Goal.FAT_LOSS, -0.5, WeekStatus.ON_TRACK),
        (Goal.FAT_LOSS, -1.0, WeekStatus.ON_TRACK),
        (Goal.FAT_LOSS, -0.2, WeekStatus.TOO_SLOW),
        (Goal.FAT_LOSS, 0.4, WeekStatus.TOO_SLOW),
        (Goal.FAT_LOSS, -1.4, WeekStatus.TOO_FAST),
        (Goal.MAINTAIN, 0.2, WeekStatus.ON_TRACK),
        (Goal.MAINTAIN, -0.2, WeekStatus.ON_TRACK),
        (Goal.MAINTAIN, 0.5, WeekStatus.TOO_FAST),
        (Goal.MAINTAIN, -0.5, WeekStatus.TOO_FAST),
    ],
)
def test_week_status(goal: Goal, rate: float, status: WeekStatus) -> None:
    assert week_status(goal, rate) == status


@pytest.mark.parametrize(
    ("target", "actual", "delta"),
    [
        # (0.3 - 0.1) * 1100 = 220, to the nearest 50.
        (0.3, 0.1, 200),
        (0.3, 0.3, 0),
        # (-0.6 - -0.3) * 1100 = -330, clamped.
        (-0.6, -0.3, -300),
        (0.5, -1.0, 300),
        (0.1, 0.2, -100),
    ],
)
def test_delta_kcal(target: float, actual: float, delta: int) -> None:
    assert delta_kcal(target, actual) == delta


def test_rate_is_a_percentage_of_last_weeks_average() -> None:
    assert rate_pct(79.2, 80.0) == pytest.approx(-1.0)


def test_adaptive_tdee_needs_twelve_of_fourteen_days() -> None:
    assert adaptive_tdee([2500] * 11, 0.1) is None
    # 2500 - 0.1 * 7700 / 7.
    assert adaptive_tdee([2500] * 12, 0.1) == 2390
    assert adaptive_tdee([2000] * 14, -0.5) == 2550


@pytest.mark.parametrize(
    ("kcal", "rate", "previous", "expected"),
    [
        ([900] * 7, 0.0, 0.0, True),
        ([900] * 6, 0.0, 0.0, False),
        ([900] * 6 + [1000], 0.0, 0.0, False),
        # A logged day of black coffee counts.
        ([0] * 7, None, None, True),
        ([], -1.6, -1.6, True),
        ([], -1.6, -1.4, False),
        ([], -1.6, None, False),
        ([], None, -1.6, False),
    ],
)
def test_check_in(
    kcal: list[float], rate: float | None, previous: float | None, expected: bool
) -> None:
    assert needs_check_in(kcal, rate, previous) is expected


def test_too_slow_a_gain_adds_calories_and_recomputes_macros() -> None:
    result = weekly_adjustment(week())

    assert result.status == WeekStatus.TOO_SLOW
    assert result.delta_kcal == 200
    assert result.rate_pct == pytest.approx(0.125)
    # Protein 1.8 * 80.1; fat 25 % of 3000; carbs (3000 - 4 * 144 - 9 * 83) / 4.
    assert result.targets == DailyTargets(3000, 144, 419, 83)
    assert result.floor_hit is False


def test_on_track_changes_nothing() -> None:
    result = weekly_adjustment(week(average_kg=80.3))

    assert result.status == WeekStatus.ON_TRACK
    assert result.delta_kcal == 0
    assert result.targets == CURRENT


def test_a_stalled_cut_removes_calories() -> None:
    result = weekly_adjustment(week(goal=Goal.FAT_LOSS, average_kg=80.0))

    # Aiming for -0.75 % of 80 kg = -0.6 kg: -660 a day, clamped to -300.
    assert result.status == WeekStatus.TOO_SLOW
    assert result.delta_kcal == -300
    assert result.targets.kcal == 2500


def test_the_floor_holds_and_says_so() -> None:
    result = weekly_adjustment(week(goal=Goal.FAT_LOSS, average_kg=80.0, floor_kcal=2700))

    assert result.targets.kcal == 2700
    assert result.delta_kcal == -100
    assert result.floor_hit is True


def test_a_check_in_never_cuts() -> None:
    result = weekly_adjustment(week(goal=Goal.FAT_LOSS, average_kg=80.0, check_in=True))

    assert result.delta_kcal == 0
    assert result.targets == CURRENT


def test_a_check_in_may_still_add() -> None:
    result = weekly_adjustment(week(goal=Goal.FAT_LOSS, average_kg=78.0, check_in=True))

    # Losing 2 kg against a plan of 0.6 kg.
    assert result.status == WeekStatus.TOO_FAST
    assert result.delta_kcal == 300


def facts(**overrides: object) -> WeekFacts:
    values: dict[str, object] = {
        "goal": "fat_loss",
        "experience": "beginner",
        "weekly_avg": 80.0,
        "prev_avg": 80.5,
        "rate_pct": -0.62,
        "target_rate_range": (-1.0, -0.5),
        "status": WeekStatus.ON_TRACK,
        "old_targets": None,
        "new_targets": None,
        "avg_protein_g": 120.0,
        "avg_kcal_logged": 2000.0,
        "days_logged": 6,
        "workouts_this_week": 3,
        "check_in": False,
        "floor_hit": False,
        **overrides,
    }
    return WeekFacts(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize("status", list(WeekStatus))
def test_every_status_has_template_tips(status: WeekStatus) -> None:
    tips = template_tips(facts(status=status))

    assert tips.headline
    assert 2 <= len(tips.tips) <= 4


def test_safety_tips_come_first_and_the_list_stays_short() -> None:
    written = WeeklyTips(headline="Fine", tips=["a", "b", "c", "d"])

    tips = with_safety(written, facts(check_in=True, floor_hit=True))

    assert tips.tips == [CHECK_IN_TIP, FLOOR_TIP, "a", "b"]


@pytest.mark.parametrize(
    ("moment", "zone", "due"),
    [
        (datetime(2026, 11, 2, 6, 5, tzinfo=UTC), "UTC", True),
        (datetime(2026, 11, 2, 7, 5, tzinfo=UTC), "UTC", False),
        # 06:35 Monday in India is 01:05 UTC.
        (datetime(2026, 11, 2, 1, 5, tzinfo=UTC), "Asia/Kolkata", True),
        # Sunday evening UTC is already Monday morning in Auckland.
        (datetime(2026, 11, 1, 17, 5, tzinfo=UTC), "Pacific/Auckland", True),
        (datetime(2026, 11, 3, 6, 5, tzinfo=UTC), "UTC", False),
    ],
)
def test_report_hour_is_local(moment: datetime, zone: str, due: bool) -> None:
    assert is_report_hour(moment, ZoneInfo(zone)) is due


def test_the_last_full_week_ended_on_the_last_sunday() -> None:
    wednesday = datetime(2026, 11, 4, 12, tzinfo=UTC)
    monday = datetime(2026, 11, 2, 6, tzinfo=UTC)

    assert last_full_week(wednesday, ZoneInfo("UTC")) == date(2026, 10, 26)
    assert last_full_week(monday, ZoneInfo("UTC")) == date(2026, 10, 26)
