from datetime import UTC, date
from zoneinfo import ZoneInfo

import pytest

from app.core.errors import AppError
from app.services.water import daily_goal_ml, day_bounds, parse_day


@pytest.mark.parametrize(
    ("weight", "custom", "trained", "goal"),
    [
        (80, None, False, 2800),  # 35 x 80
        (80, None, True, 3300),  # +500 on a training day
        (71.3, None, False, 2500),  # 2495.5 rounds to 2500
        (None, None, False, 2500),  # no weigh-in yet
        (80, 2000, False, 2000),  # the user's own goal replaces 35 ml/kg
        (80, 2000, True, 2500),
    ],
)
def test_daily_goal(weight: float | None, custom: int | None, trained: bool, goal: int) -> None:
    assert daily_goal_ml(weight, custom, trained) == goal


def test_a_day_is_local_midnight_to_midnight() -> None:
    start, end = day_bounds(date(2026, 10, 30), ZoneInfo("Asia/Kolkata"))
    assert start.isoformat() == "2026-10-30T00:00:00+05:30"
    assert end.isoformat() == "2026-10-31T00:00:00+05:30"
    # The day Europe leaves summer time has 25 hours (measured in UTC: Python subtracts
    # datetimes that share a tzinfo by wall clock).
    start, end = day_bounds(date(2026, 10, 25), ZoneInfo("Europe/Berlin"))
    assert (end.astimezone(UTC) - start.astimezone(UTC)).total_seconds() == 25 * 3600


def test_days_parse() -> None:
    assert parse_day("2026-10-30") == date(2026, 10, 30)
    with pytest.raises(AppError) as info:
        parse_day("30/10/2026")
    assert info.value.details[0]["loc"] == ["query", "date"]
