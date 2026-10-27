"""The signed-in user's account, onboarding profile and app settings (`/me`)."""

import uuid
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError
from app.db.models import BodyWeight, User, UserProfile, UserSettings, WeightSource
from app.schemas.me import MeOut, MeUpdate, ProfileOut, ProfileUpdate, SettingsOut, SettingsUpdate
from app.schemas.user import UserOut
from app.services.auth import conflict_from, username_available

# Everything the calorie engine (BMR, TDEE, targets) needs; units and timezone have defaults.
ONBOARDING_FIELDS = (
    "sex",
    "birth_date",
    "height_cm",
    "weight_kg",
    "activity_level",
    "goal",
    "experience",
)
MIN_AGE = 13
MAX_AGE = 100


# --- pure helpers -----------------------------------------------------------------------


def age_on(birth_date: date, today: date) -> int:
    had_birthday = (today.month, today.day) >= (birth_date.month, birth_date.day)
    return today.year - birth_date.year - (0 if had_birthday else 1)


def birth_date_problem(birth_date: date, today: date) -> str | None:
    if birth_date > today:
        return "birth date is in the future"
    age = age_on(birth_date, today)
    if age < MIN_AGE:
        return f"you must be at least {MIN_AGE} to use RepForge"
    if age > MAX_AGE:
        return f"age must be {MAX_AGE} or less"
    return None


def round_half_up(value: float, places: int) -> float:
    """Round like people expect (168.25 → 168.3); built-in round() gives 168.2 here."""
    return float(Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def missing_onboarding_fields(profile: UserProfile, weight_kg: float | None) -> list[str]:
    answered = {name: getattr(profile, name, None) for name in ONBOARDING_FIELDS}
    answered["weight_kg"] = weight_kg
    return [name for name in ONBOARDING_FIELDS if answered[name] is None]


def invalid_at(loc: list[str | int], message: str) -> AppError:
    """A 422 shaped exactly like request-validation errors, for checks that need the DB."""
    return AppError(
        "validation_error",
        "Request is invalid",
        422,
        [{"loc": loc, "msg": message, "type": "value_error"}],
    )


def field_error(field: str, message: str) -> AppError:
    return invalid_at(["body", field], message)


# --- loading ----------------------------------------------------------------------------


async def latest_weight_kg(session: AsyncSession, user_id: uuid.UUID) -> float | None:
    return await session.scalar(
        select(BodyWeight.weight_kg)
        .where(BodyWeight.user_id == user_id, BodyWeight.deleted_at.is_(None))
        .order_by(BodyWeight.measured_at.desc())
        .limit(1)
    )


async def load_profile(session: AsyncSession, user_id: uuid.UUID) -> UserProfile:
    # Rows are created with the user; get-or-create keeps /me working even if one is missing.
    profile = await session.get(UserProfile, user_id)
    if profile is None:
        profile = UserProfile(user_id=user_id)
        session.add(profile)
        await session.flush()
    return profile


async def load_settings(session: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    settings = await session.get(UserSettings, user_id)
    if settings is None:
        settings = UserSettings(user_id=user_id)
        session.add(settings)
        await session.flush()
    return settings


def profile_out(profile: UserProfile, weight_kg: float | None) -> ProfileOut:
    columns = {
        name: getattr(profile, name) for name in ProfileOut.model_fields if name != "weight_kg"
    }
    return ProfileOut.model_validate({**columns, "weight_kg": weight_kg})


async def get_me(session: AsyncSession, user: User) -> MeOut:
    profile = await load_profile(session, user.id)
    settings = await load_settings(session, user.id)
    weight = await latest_weight_kg(session, user.id)
    # Commit in case get-or-create inserted a row.
    await session.commit()
    return MeOut(
        **UserOut.model_validate(user).model_dump(),
        profile=profile_out(profile, weight),
        settings=SettingsOut.model_validate(settings),
        onboarding_complete=profile.onboarding_completed_at is not None,
    )


# --- updates ----------------------------------------------------------------------------


async def update_me(session: AsyncSession, user: User, patch: MeUpdate) -> MeOut:
    changes = patch.changes()
    username = patch.username
    if (
        username is not None
        and username != user.username
        and not await username_available(session, username)
    ):
        raise ConflictError("username_taken", "That username is taken")
    for name, value in changes.items():
        setattr(user, name, value)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise conflict_from(exc) from exc
    return await get_me(session, user)


async def update_profile(
    session: AsyncSession, user: User, patch: ProfileUpdate, now: datetime
) -> ProfileOut:
    changes = patch.changes()
    complete = changes.pop("onboarding_complete", None)
    new_weight = changes.pop("weight_kg", None)

    birth_date = changes.get("birth_date")
    if birth_date is not None and (problem := birth_date_problem(birth_date, now.date())):
        raise field_error("birth_date", problem)
    if "height_cm" in changes:
        changes["height_cm"] = round_half_up(changes["height_cm"], 1)

    profile = await load_profile(session, user.id)
    for name, value in changes.items():
        setattr(profile, name, value)

    if new_weight is not None:
        weight: float | None = round_half_up(new_weight, 2)
        session.add(
            BodyWeight(
                user_id=user.id, measured_at=now, weight_kg=weight, source=WeightSource.MANUAL
            )
        )
    else:
        weight = await latest_weight_kg(session, user.id)

    # Onboarding completes once and stays complete; `false` is accepted and ignored.
    if complete and profile.onboarding_completed_at is None:
        missing = missing_onboarding_fields(profile, weight)
        if missing:
            raise AppError(
                "onboarding_incomplete",
                "Answer every onboarding question first",
                422,
                {"missing": missing},
            )
        profile.onboarding_completed_at = now

    await session.commit()
    return profile_out(profile, weight)


async def get_settings_out(session: AsyncSession, user: User) -> SettingsOut:
    settings = await load_settings(session, user.id)
    await session.commit()
    return SettingsOut.model_validate(settings)


async def update_settings(session: AsyncSession, user: User, patch: SettingsUpdate) -> SettingsOut:
    settings = await load_settings(session, user.id)
    changes = patch.changes()
    # Checked against the merged result: a PATCH may change only one of the two.
    wake = changes.get("wake_time", settings.wake_time)
    sleep = changes.get("sleep_time", settings.sleep_time)
    if wake == sleep:
        raise field_error(
            "wake_time" if "wake_time" in changes else "sleep_time",
            "wake and sleep times must differ",
        )
    for name, value in changes.items():
        setattr(settings, name, value)
    await session.commit()
    return SettingsOut.model_validate(settings)
