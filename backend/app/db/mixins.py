from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class TimestampMixin:
    # Fetch server-generated values with RETURNING on INSERT *and* UPDATE. Otherwise
    # `updated_at` is expired after a flush, and reading it would lazy-load, which fails
    # under asyncio (MissingGreenlet).
    __mapper_args__: ClassVar[dict[str, Any]] = {"eager_defaults": True}

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SyncableMixin(TimestampMixin):
    """Columns every offline-synced table carries (CLAUDE.md §3, decision 2).

    Rows are soft-deleted so a deletion can be pulled by other devices. Phase 4 adds the
    `change_seq` cursor column to these tables.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(default=1, server_default="1")
