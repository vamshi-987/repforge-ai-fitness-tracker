from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest
from fakeredis import FakeAsyncRedis

from app.config import Settings
from app.core.errors import RateLimitedError
from app.db.models import User
from app.services.ai_limits import daily_limit, enforce_daily_limit

NOW = datetime(2026, 11, 5, 8, tzinfo=UTC)
SETTINGS = Settings(_env_file=None)


def user(is_pro: bool = False) -> User:
    return cast(User, SimpleNamespace(id=uuid4(), is_pro=is_pro))


@pytest.mark.parametrize(
    ("feature", "is_pro", "limit"),
    [("photo", False, 5), ("photo", True, 50), ("text", False, 20), ("text", True, 200)],
)
def test_limits_per_plan(feature: Any, is_pro: bool, limit: int) -> None:
    assert daily_limit(SETTINGS, feature, is_pro) == limit


async def test_a_free_user_gets_five_photos_a_day() -> None:
    redis = FakeAsyncRedis(decode_responses=True)
    someone = user()

    for _ in range(5):
        await enforce_daily_limit(redis, SETTINGS, someone, "photo", NOW)

    with pytest.raises(RateLimitedError) as caught:
        await enforce_daily_limit(redis, SETTINGS, someone, "photo", NOW)
    assert caught.value.details == {"retry_after_s": 86_400}
    # A day later the window has moved on; other users and features were never affected.
    await enforce_daily_limit(redis, SETTINGS, someone, "photo", NOW + timedelta(days=1, seconds=1))
    await enforce_daily_limit(redis, SETTINGS, user(), "photo", NOW)
    await enforce_daily_limit(redis, SETTINGS, someone, "text", NOW)
