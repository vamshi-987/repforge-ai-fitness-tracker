import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import SyncableMixin


class WaterLog(SyncableMixin, Base):
    """One drink. The day it counts for is the user's local date of `logged_at`."""

    __tablename__ = "water_logs"
    __table_args__ = (
        Index("ix_water_logs_user_id_logged_at", "user_id", "logged_at"),
        Index("ix_water_logs_user_id_change_seq", "user_id", "change_seq"),
        CheckConstraint("amount_ml > 0 AND amount_ml <= 5000", name="amount_in_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    amount_ml: Mapped[int]
