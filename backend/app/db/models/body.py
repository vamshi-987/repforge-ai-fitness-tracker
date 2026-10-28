import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import SyncableMixin
from app.db.types import str_enum


class WeightSource(StrEnum):
    MANUAL = "manual"
    HEALTH = "health"


class BodyWeight(SyncableMixin, Base):
    """One weigh-in. Created by onboarding in Phase 1; full CRUD and trends arrive in Phase 5."""

    __tablename__ = "body_weights"
    __table_args__ = (
        Index("ix_body_weights_user_id_measured_at", "user_id", "measured_at"),
        Index("ix_body_weights_user_id_change_seq", "user_id", "change_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    weight_kg: Mapped[float] = mapped_column(Numeric(5, 2, asdecimal=False))
    source: Mapped[WeightSource] = mapped_column(
        str_enum(WeightSource, "weight_source"), default=WeightSource.MANUAL
    )
