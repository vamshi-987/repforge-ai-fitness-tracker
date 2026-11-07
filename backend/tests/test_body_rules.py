from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from app.db.models import MeasurementKind
from app.schemas.body import MeasurementIn, UploadRequest
from app.services.body import WeighIn, weekly_averages

UTC_ZONE = ZoneInfo("UTC")


def w(day: int, kg: float, hour: int = 7) -> WeighIn:
    return WeighIn(datetime(2026, 10, day, hour, tzinfo=UTC), kg)


def test_a_week_needs_three_weigh_ins_for_an_average() -> None:
    weeks = weekly_averages(
        [w(19, 80.0), w(20, 80.4), w(22, 79.8), w(26, 79.5), w(27, 79.0)], UTC_ZONE
    )

    assert [(x.week_start, x.weigh_ins, x.average_kg) for x in weeks] == [
        (date(2026, 10, 19), 3, 80.07),
        (date(2026, 10, 26), 2, None),
    ]


def test_weeks_follow_the_users_timezone() -> None:
    # Sunday 20:00 UTC is Monday morning in India: the next week.
    weeks = weekly_averages([w(25, 80, hour=20)], ZoneInfo("Asia/Kolkata"))
    assert weeks[0].week_start == date(2026, 10, 26)
    assert weekly_averages([], UTC_ZONE) == []


@pytest.mark.parametrize(
    ("kind", "value", "ok"),
    [
        (MeasurementKind.WAIST, 82.5, True),
        (MeasurementKind.WAIST, 5, False),
        (MeasurementKind.BODY_FAT, 15.5, True),
        (MeasurementKind.BODY_FAT, 82.5, False),
    ],
)
def test_measurements_must_be_plausible(kind: MeasurementKind, value: float, ok: bool) -> None:
    body = {"measured_at": "2026-10-30T07:00:00Z", "kind": kind.value, "value": value}
    if ok:
        assert MeasurementIn.model_validate(body).value == value
    else:
        with pytest.raises(ValidationError):
            MeasurementIn.model_validate(body)


def test_only_images_can_be_uploaded() -> None:
    assert UploadRequest(kind="progress_photo", content_type="image/heic").content_type
    with pytest.raises(ValidationError):
        UploadRequest.model_validate({"kind": "progress_photo", "content_type": "text/html"})
