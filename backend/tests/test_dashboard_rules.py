import uuid
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest
from fakeredis import FakeAsyncRedis
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.errors import AppError
from app.schemas.stats import CalendarDay, CalendarMonth
from app.services.dashboard import _cached, parse_month
from app.services.stats import (
    WorkoutMark,
    bump_generation,
    daily_counts,
    local_day,
    streak_weeks,
    week_start,
    weekly_buckets,
)

UTC_ZONE = ZoneInfo("UTC")
KOLKATA = ZoneInfo("Asia/Kolkata")
USER = uuid.uuid5(uuid.NAMESPACE_DNS, "user")


def mark(day: int, hour: int = 18, volume: float = 100, sets: int = 5) -> WorkoutMark:
    return WorkoutMark(datetime(2026, 10, day, hour, tzinfo=UTC), 3600, volume, sets)


@pytest.mark.parametrize(
    ("day", "monday"),
    [(date(2026, 10, 26), date(2026, 10, 26)), (date(2026, 11, 1), date(2026, 10, 26))],
)
def test_weeks_start_on_monday(day: date, monday: date) -> None:
    assert week_start(day) == monday


def test_days_are_in_the_users_timezone() -> None:
    late = datetime(2026, 10, 25, 20, 0, tzinfo=UTC)
    assert local_day(late, UTC_ZONE) == date(2026, 10, 25)
    # 01:30 the next day in India, and the next week too (25 Oct is a Sunday).
    assert local_day(late, KOLKATA) == date(2026, 10, 26)
    assert daily_counts([mark(25, 20), mark(26, 7)], KOLKATA) == {date(2026, 10, 26): 2}


def test_weekly_buckets_include_empty_weeks() -> None:
    weeks = weekly_buckets(
        [mark(5), mark(7, volume=50.255, sets=3), mark(20), mark(1)],
        date(2026, 10, 5),
        date(2026, 10, 26),
        UTC_ZONE,
    )

    assert list(weeks) == [
        date(2026, 10, 5),
        date(2026, 10, 12),
        date(2026, 10, 19),
        date(2026, 10, 26),
    ]
    first = weeks[date(2026, 10, 5)]
    assert (first.workouts, first.duration_s, first.volume_kg, first.sets) == (2, 7200, 150.26, 8)
    assert weeks[date(2026, 10, 12)].workouts == 0
    # 1 October is before the first week: left out.
    assert sum(b.workouts for b in weeks.values()) == 3


@pytest.mark.parametrize(
    ("trained", "streak"),
    [
        ([], 0),
        ([date(2026, 10, 26)], 1),
        ([date(2026, 10, 26), date(2026, 10, 19), date(2026, 10, 12)], 3),
        # This week has no workout yet: the streak up to last week still counts.
        ([date(2026, 10, 19), date(2026, 10, 12)], 2),
        # A missed week ends it.
        ([date(2026, 10, 26), date(2026, 10, 12)], 1),
        ([date(2026, 10, 12)], 0),
    ],
)
def test_streak_weeks(trained: list[date], streak: int) -> None:
    assert streak_weeks(set(trained), date(2026, 10, 26)) == streak


@pytest.mark.parametrize("month", ["2026-1", "2026-13", "26-10", "2026/10", "soon"])
def test_bad_months_are_refused(month: str) -> None:
    with pytest.raises(AppError) as info:
        parse_month(month)
    assert info.value.code == "validation_error"


def test_months_parse() -> None:
    assert parse_month("2026-10") == (2026, 10)


VALUE = CalendarMonth(
    month="2026-10", days=[CalendarDay(date=date(2026, 10, 5), workouts=1)], streak_weeks=2
)


async def test_the_cache_holds_until_the_generation_moves() -> None:
    redis = FakeAsyncRedis(decode_responses=True)
    calls = 0

    async def compute() -> CalendarMonth:
        nonlocal calls
        calls += 1
        return VALUE

    assert await _cached(redis, USER, "calendar:2026-10", CalendarMonth, compute) == VALUE
    assert await _cached(redis, USER, "calendar:2026-10", CalendarMonth, compute) == VALUE
    assert calls == 1
    await bump_generation(redis, USER)
    await _cached(redis, USER, "calendar:2026-10", CalendarMonth, compute)
    assert calls == 2


class DownRedis:
    async def get(self, _: str) -> None:
        raise RedisConnectionError("down")


class ReadOnlyRedis(FakeAsyncRedis):
    async def set(self, *_: object, **__: object) -> None:
        raise RedisConnectionError("read only")


async def test_the_cache_fails_open() -> None:
    async def compute() -> CalendarMonth:
        return VALUE

    assert await _cached(DownRedis(), USER, "k", CalendarMonth, compute) == VALUE  # type: ignore[arg-type]
    assert (
        await _cached(ReadOnlyRedis(decode_responses=True), USER, "k", CalendarMonth, compute)
        == VALUE
    )
