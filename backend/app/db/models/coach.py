import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class OverloadRule(StrEnum):
    INCREASE_WEIGHT = "increase_weight"
    ADD_REPS = "add_reps"
    REDUCE_WEIGHT = "reduce_weight"
    DELOAD = "deload"
    SWAP = "swap"


class WeeklyReport(Base):
    """One week's numbers and tips. Targets change only when the user applies it."""

    __tablename__ = "weekly_reports"
    __table_args__ = (UniqueConstraint("user_id", "week_start"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The Monday of the week reported on, in the user's timezone.
    week_start: Mapped[date] = mapped_column(Date)
    avg_weight_kg: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False))
    prev_avg_weight_kg: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False))
    rate_pct: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False))
    status: Mapped[str] = mapped_column(String(20))
    suggested_targets: Mapped[dict[str, int] | None] = mapped_column(JSONB)
    headline: Mapped[str] = mapped_column(String(200))
    tips: Mapped[list[str]] = mapped_column(ARRAY(Text))
    # The rest of what the card shows: rate range, delta, TDEE, logging, safety flags.
    details: Mapped[dict[str, Any]] = mapped_column(JSONB)
    applied: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OverloadSuggestion(Base):
    """What the coach suggested for an exercise. The latest row stands until a newer session."""

    __tablename__ = "overload_suggestions"
    __table_args__ = (
        Index(
            "ix_overload_suggestions_user_id_exercise_id_generated_at",
            "user_id",
            "exercise_id",
            "generated_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    exercise_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("exercises.id", ondelete="CASCADE"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    rule: Mapped[OverloadRule] = mapped_column(str_enum(OverloadRule, "overload_rule"))
    target_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    explanation: Mapped[str] = mapped_column(Text)
