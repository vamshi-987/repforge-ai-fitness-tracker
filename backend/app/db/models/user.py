import uuid
from datetime import date, datetime, time
from enum import StrEnum

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    false,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.db.types import str_enum


class AuthProvider(StrEnum):
    PASSWORD = "password"
    GOOGLE = "google"
    APPLE = "apple"


class Sex(StrEnum):
    """Biological sex, used only for the BMR formula (Mifflin-St Jeor)."""

    MALE = "male"
    FEMALE = "female"


class ActivityLevel(StrEnum):
    SEDENTARY = "sedentary"
    LIGHT = "light"
    MODERATE = "moderate"
    ACTIVE = "active"
    VERY_ACTIVE = "very_active"


class Goal(StrEnum):
    MUSCLE_GAIN = "muscle_gain"
    FAT_LOSS = "fat_loss"
    MAINTAIN = "maintain"


class Experience(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class WeightUnit(StrEnum):
    KG = "kg"
    LB = "lb"


class LengthUnit(StrEnum):
    CM = "cm"
    IN = "in"


class Theme(StrEnum):
    SYSTEM = "system"
    LIGHT = "light"
    DARK = "dark"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Stored lowercased (services.auth.normalize_email), so a plain unique index is enough.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    # NULL for accounts created through Google/Apple only.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # How the account was first created; linked providers are the *_sub columns.
    auth_provider: Mapped[AuthProvider] = mapped_column(str_enum(AuthProvider, "auth_provider"))
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    apple_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    username: Mapped[str] = mapped_column(String(30), unique=True)
    display_name: Mapped[str] = mapped_column(String(60))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    is_private: Mapped[bool] = mapped_column(default=False, server_default=false())
    is_pro: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Set by account deletion (Phase 9); a hard delete follows within 30 days.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserProfile(TimestampMixin, Base):
    """Body and goal data from onboarding. NULL fields are not answered yet."""

    __tablename__ = "user_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    sex: Mapped[Sex | None] = mapped_column(str_enum(Sex, "sex"))
    birth_date: Mapped[date | None] = mapped_column(Date)
    height_cm: Mapped[float | None] = mapped_column(Numeric(4, 1, asdecimal=False))
    activity_level: Mapped[ActivityLevel | None] = mapped_column(
        str_enum(ActivityLevel, "activity_level")
    )
    goal: Mapped[Goal | None] = mapped_column(str_enum(Goal, "goal"))
    experience: Mapped[Experience | None] = mapped_column(str_enum(Experience, "experience"))
    unit_weight: Mapped[WeightUnit] = mapped_column(
        str_enum(WeightUnit, "unit_weight"), default=WeightUnit.KG, server_default="kg"
    )
    unit_length: Mapped[LengthUnit] = mapped_column(
        str_enum(LengthUnit, "unit_length"), default=LengthUnit.CM, server_default="cm"
    )
    # NULL means "use the computed goal" (35 ml per kg, Phase 5).
    water_goal_ml: Mapped[int | None] = mapped_column(Integer)
    # IANA name; decides the user's local day for food logs, water and weekly reports.
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSettings(TimestampMixin, Base):
    __tablename__ = "user_settings"
    __table_args__ = (CheckConstraint("wake_time <> sleep_time", name="wake_differs_from_sleep"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    theme: Mapped[Theme] = mapped_column(
        str_enum(Theme, "theme"), default=Theme.SYSTEM, server_default="system"
    )
    default_rest_s: Mapped[int] = mapped_column(default=90, server_default="90")
    keep_awake: Mapped[bool] = mapped_column(default=True, server_default=true())
    show_burned_kcal: Mapped[bool] = mapped_column(default=False, server_default=false())
    water_cup_sizes: Mapped[list[int]] = mapped_column(
        ARRAY(Integer),
        default=lambda: [250, 500, 750],
        server_default=text("'{250,500,750}'"),
    )
    water_reminder_every_h: Mapped[int] = mapped_column(default=2, server_default="2")
    wake_time: Mapped[time] = mapped_column(
        Time, default=time(7, 0), server_default=text("'07:00'")
    )
    sleep_time: Mapped[time] = mapped_column(
        Time, default=time(22, 0), server_default=text("'22:00'")
    )
    reminders_enabled: Mapped[bool] = mapped_column(default=False, server_default=false())
