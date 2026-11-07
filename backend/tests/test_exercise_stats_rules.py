import uuid

import pytest

from app.core.errors import AppError
from app.db.models import ExerciseType, SetType, User
from app.schemas.stats import StatsRange
from app.services.pro import ensure_pro, require_pro
from app.services.records import SetPerf
from app.services.stats import SessionPoint, session_point


def s(weight: float | None, reps: int, kind: SetType = SetType.NORMAL, ident: int = 0) -> SetPerf:
    return SetPerf(uuid.UUID(int=ident), kind, weight, reps, True)


@pytest.mark.parametrize(
    ("kind", "sets", "expected"),
    [
        pytest.param(
            ExerciseType.WEIGHT_REPS,
            [s(40, 10, SetType.WARMUP), s(100, 5, ident=1), s(90, 8, ident=2)],
            SessionPoint(100, 116.67, False, 720, 1220, 13),
            id="loaded lift; warm-ups left out",
        ),
        pytest.param(
            ExerciseType.WEIGHT_REPS,
            [s(50, 20, ident=1)],
            SessionPoint(50, 83.33, True, 1000, 1000, 20),
            id="e1RM from a high-rep set is marked rough",
        ),
        pytest.param(
            ExerciseType.BODYWEIGHT_REPS,
            [s(None, 12), s(None, 10)],
            SessionPoint(None, None, False, None, None, 22),
            id="bodyweight",
        ),
        pytest.param(
            ExerciseType.DURATION,
            [SetPerf(uuid.UUID(int=0), SetType.NORMAL, None, None, True)],
            SessionPoint(None, None, False, None, None, None),
            id="timed",
        ),
    ],
)
def test_session_point(kind: ExerciseType, sets: list[SetPerf], expected: SessionPoint) -> None:
    assert session_point(kind, sets) == expected


@pytest.mark.parametrize(
    ("value", "pro"),
    [
        (StatsRange.MONTH, False),
        (StatsRange.QUARTER, False),
        (StatsRange.YEAR, True),
        (StatsRange.ALL, True),
    ],
)
def test_ranges_past_three_months_are_pro(value: StatsRange, pro: bool) -> None:
    assert value.is_pro is pro
    assert (value.span is None) is (value == StatsRange.ALL)


async def test_the_pro_gate() -> None:
    free, paid = User(is_pro=False), User(is_pro=True)
    with pytest.raises(AppError) as info:
        ensure_pro(free, "Long charts")
    assert (info.value.code, info.value.status_code) == ("pro_required", 403)
    assert info.value.details == {"feature": "Long charts"}
    ensure_pro(paid, "Long charts")
    assert await require_pro(paid) is paid
    with pytest.raises(AppError):
        await require_pro(free)
