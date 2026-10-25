from datetime import date

import pytest
from pydantic import ValidationError

from app.db.models import ActivityLevel, Experience, Goal, Sex, UserProfile
from app.schemas.me import MeUpdate, ProfileUpdate, SettingsUpdate
from app.services.profile import (
    ONBOARDING_FIELDS,
    age_on,
    birth_date_problem,
    field_error,
    missing_onboarding_fields,
    round_half_up,
)

TODAY = date(2026, 10, 25)


@pytest.mark.parametrize(
    ("birth", "age"),
    [
        (date(1996, 10, 25), 30),  # birthday today
        (date(1996, 10, 26), 29),  # birthday tomorrow
        (date(1996, 1, 1), 30),
        (date(2000, 2, 29), 26),  # leap-day birthday
    ],
)
def test_age_on(birth: date, age: int) -> None:
    assert age_on(birth, TODAY) == age


@pytest.mark.parametrize(
    ("birth", "problem"),
    [
        (date(1990, 5, 1), None),
        (date(2013, 10, 25), None),  # exactly 13
        (date(2013, 10, 26), "you must be at least 13 to use RepForge"),
        (date(2027, 1, 1), "birth date is in the future"),
        (date(1925, 10, 24), "age must be 100 or less"),
    ],
)
def test_birth_date_problem(birth: date, problem: str | None) -> None:
    assert birth_date_problem(birth, TODAY) == problem


def test_missing_onboarding_fields_lists_everything_for_a_new_profile() -> None:
    assert missing_onboarding_fields(UserProfile(), None) == list(ONBOARDING_FIELDS)


def test_complete_profile_has_nothing_missing() -> None:
    profile = UserProfile(
        sex=Sex.FEMALE,
        birth_date=date(1995, 3, 1),
        height_cm=168.0,
        activity_level=ActivityLevel.MODERATE,
        goal=Goal.FAT_LOSS,
        experience=Experience.BEGINNER,
    )

    assert missing_onboarding_fields(profile, 64.5) == []
    assert missing_onboarding_fields(profile, None) == ["weight_kg"]


def test_field_error_matches_validation_envelope() -> None:
    error = field_error("birth_date", "too young")

    assert (error.code, error.status_code) == ("validation_error", 422)
    assert error.details == [
        {"loc": ["body", "birth_date"], "msg": "too young", "type": "value_error"}
    ]


# --- PATCH schemas ----------------------------------------------------------------------


def test_patch_keeps_only_sent_fields() -> None:
    assert ProfileUpdate.model_validate({"goal": "maintain"}).changes() == {"goal": Goal.MAINTAIN}


def test_null_is_rejected_for_required_fields() -> None:
    with pytest.raises(ValidationError, match="sex cannot be null"):
        ProfileUpdate.model_validate({"sex": None})
    with pytest.raises(ValidationError, match="display_name cannot be null"):
        MeUpdate.model_validate({"display_name": None})


def test_null_clears_clearable_fields() -> None:
    assert ProfileUpdate.model_validate({"water_goal_ml": None}).changes() == {
        "water_goal_ml": None
    }


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        MeUpdate.model_validate({"is_pro": True})


@pytest.mark.parametrize("tz", ["Asia/Kolkata", "America/New_York", "UTC"])
def test_valid_timezones(tz: str) -> None:
    assert ProfileUpdate.model_validate({"timezone": tz}).timezone == tz


@pytest.mark.parametrize("tz", ["Mars/Olympus", "../../etc/passwd", "IST", ""])
def test_invalid_timezones(tz: str) -> None:
    with pytest.raises(ValidationError):
        ProfileUpdate.model_validate({"timezone": tz})


@pytest.mark.parametrize(
    ("payload", "ok"),
    [
        ({"height_cm": 99.9}, False),
        ({"height_cm": 250}, True),
        ({"weight_kg": 24}, False),
        ({"weight_kg": 80.25}, True),
        ({"water_goal_ml": 400}, False),
        ({"unit_weight": "stone"}, False),
    ],
)
def test_profile_ranges(payload: dict[str, object], ok: bool) -> None:
    if ok:
        ProfileUpdate.model_validate(payload)
    else:
        with pytest.raises(ValidationError):
            ProfileUpdate.model_validate(payload)


def test_cup_sizes_are_sorted_and_distinct() -> None:
    assert SettingsUpdate.model_validate({"water_cup_sizes": [750, 250]}).water_cup_sizes == [
        250,
        750,
    ]
    for bad in ([], [250, 250], [10], [250] * 7):
        with pytest.raises(ValidationError):
            SettingsUpdate.model_validate({"water_cup_sizes": bad})


@pytest.mark.parametrize("rest", [-1, 901])
def test_rest_timer_range(rest: int) -> None:
    with pytest.raises(ValidationError):
        SettingsUpdate.model_validate({"default_rest_s": rest})


@pytest.mark.parametrize(
    ("value", "places", "expected"),
    [(168.25, 1, 168.3), (64.455, 2, 64.46), (2.675, 2, 2.68), (80.0, 1, 80.0), (79.94, 1, 79.9)],
)
def test_round_half_up(value: float, places: int, expected: float) -> None:
    assert round_half_up(value, places) == expected
