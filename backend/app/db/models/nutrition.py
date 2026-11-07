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
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import SyncableMixin
from app.db.types import str_enum

Grams = Numeric(8, 2, asdecimal=False)


class FoodSource(StrEnum):
    USDA = "usda"
    OFF = "off"  # Open Food Facts
    IFCT = "ifct"  # Indian Food Composition Tables (only imported locally with permission)
    CUSTOM = "custom"
    AI = "ai"


class Meal(StrEnum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"


class LogSource(StrEnum):
    SEARCH = "search"
    BARCODE = "barcode"
    PHOTO = "photo"
    TEXT = "text"
    RECENT = "recent"
    MANUAL = "manual"


class TargetReason(StrEnum):
    INITIAL = "initial"
    WEEKLY_ADJUSTMENT = "weekly_adjustment"
    MANUAL = "manual"


class Food(SyncableMixin, Base):
    """A food with nutrients per 100 g. Library foods (owner NULL) come from the seed or are
    cached from USDA / Open Food Facts on first use; custom foods belong to one user. Logs keep
    a snapshot of the values, so editing a food never rewrites history."""

    __tablename__ = "foods"
    __sync_owner__ = "owner_user_id"
    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_foods_source_external_id"),
        Index("ix_foods_owner_user_id_change_seq", "owner_user_id", "change_seq"),
        Index("ix_foods_barcode", "barcode"),
        Index(
            "ix_foods_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    source: Mapped[FoodSource] = mapped_column(str_enum(FoodSource, "food_source"))
    # The source's own id (USDA fdcId, the barcode for Open Food Facts); NULL for custom foods.
    external_id: Mapped[str | None] = mapped_column(String(64))
    barcode: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str | None] = mapped_column(String(120))
    kcal_100g: Mapped[float] = mapped_column(Numeric(7, 2, asdecimal=False))
    protein_100g: Mapped[float] = mapped_column(Numeric(6, 2, asdecimal=False))
    carbs_100g: Mapped[float] = mapped_column(Numeric(6, 2, asdecimal=False))
    fat_100g: Mapped[float] = mapped_column(Numeric(6, 2, asdecimal=False))
    fiber_100g: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False))

    servings: Mapped[list["FoodServing"]] = relationship(
        lazy="raise",
        order_by="FoodServing.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class FoodServing(Base):
    """A named portion: "1 roti" = 40 g."""

    __tablename__ = "food_servings"
    __table_args__ = (Index("ix_food_servings_food_id", "food_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    food_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("foods.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(default=0, server_default="0")
    label: Mapped[str] = mapped_column(String(80))
    grams: Mapped[float] = mapped_column(Grams)


class FoodLog(SyncableMixin, Base):
    """One food eaten. The name and per-100 g values are copied in, so the log reads the same
    after the food is edited or deleted."""

    __tablename__ = "food_logs"
    __table_args__ = (
        Index("ix_food_logs_user_id_log_date", "user_id", "log_date"),
        Index("ix_food_logs_user_id_change_seq", "user_id", "change_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # The user's local date.
    log_date: Mapped[date] = mapped_column(Date)
    meal: Mapped[Meal] = mapped_column(str_enum(Meal, "meal"))
    food_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("foods.id", ondelete="SET NULL"))
    name_snapshot: Mapped[str] = mapped_column(String(200))
    brand_snapshot: Mapped[str | None] = mapped_column(String(120))
    quantity: Mapped[float] = mapped_column(Grams)
    # "g", "ml", or a serving label ("1 roti").
    unit: Mapped[str] = mapped_column(String(80))
    grams: Mapped[float] = mapped_column(Grams)
    kcal_100g: Mapped[float] = mapped_column(Numeric(7, 2, asdecimal=False))
    protein_100g: Mapped[float] = mapped_column(Numeric(6, 2, asdecimal=False))
    carbs_100g: Mapped[float] = mapped_column(Numeric(6, 2, asdecimal=False))
    fat_100g: Mapped[float] = mapped_column(Numeric(6, 2, asdecimal=False))
    fiber_100g: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False))
    kcal: Mapped[float] = mapped_column(Numeric(7, 1, asdecimal=False))
    protein_g: Mapped[float] = mapped_column(Numeric(6, 1, asdecimal=False))
    carbs_g: Mapped[float] = mapped_column(Numeric(6, 1, asdecimal=False))
    fat_g: Mapped[float] = mapped_column(Numeric(6, 1, asdecimal=False))
    fiber_g: Mapped[float | None] = mapped_column(Numeric(6, 1, asdecimal=False))
    macros_overridden: Mapped[bool] = mapped_column(default=False, server_default=false())
    kcal_overridden: Mapped[bool] = mapped_column(default=False, server_default=false())
    source: Mapped[LogSource] = mapped_column(
        str_enum(LogSource, "food_log_source"), default=LogSource.MANUAL
    )
    # Set by the Phase 7 photo pipeline.
    photo_analysis_id: Mapped[uuid.UUID | None]


class AnalysisStatus(StrEnum):
    PENDING = "pending"
    DONE = "done"
    FAILED = "failed"


class PhotoAnalysis(Base):
    """One food photo on its way to a draft. Never a log: the user confirms the draft first."""

    __tablename__ = "photo_analyses"
    __table_args__ = (Index("ix_photo_analyses_user_id_created_at", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    object_key: Mapped[str] = mapped_column(String(120))
    status: Mapped[AnalysisStatus] = mapped_column(
        str_enum(AnalysisStatus, "photo_analysis_status"), default=AnalysisStatus.PENDING
    )
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    model: Mapped[str | None] = mapped_column(String(60))
    error: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedMeal(SyncableMixin, Base):
    """A meal saved as a template ("My usual breakfast")."""

    __tablename__ = "saved_meals"
    __table_args__ = (Index("ix_saved_meals_user_id_change_seq", "user_id", "change_seq"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))

    items: Mapped[list["SavedMealItem"]] = relationship(
        lazy="raise",
        order_by="SavedMealItem.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class SavedMealItem(Base):
    __tablename__ = "saved_meal_items"
    __table_args__ = (Index("ix_saved_meal_items_saved_meal_id", "saved_meal_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    saved_meal_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("saved_meals.id", ondelete="CASCADE")
    )
    position: Mapped[int]
    food_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("foods.id", ondelete="RESTRICT"))
    quantity: Mapped[float] = mapped_column(Grams)
    unit: Mapped[str] = mapped_column(String(80))
    grams: Mapped[float] = mapped_column(Grams)

    food: Mapped[Food] = relationship(lazy="raise")


class NutritionTarget(Base):
    """Daily targets from `effective_from` until the next row (CLAUDE.md §4.2 A)."""

    __tablename__ = "nutrition_targets"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "effective_from", name="uq_nutrition_targets_user_id_effective_from"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    effective_from: Mapped[date] = mapped_column(Date)
    kcal: Mapped[int]
    protein_g: Mapped[int]
    carbs_g: Mapped[int]
    fat_g: Mapped[int]
    reason: Mapped[TargetReason] = mapped_column(str_enum(TargetReason, "target_reason"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
