import uuid
from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import BigInteger, DateTime, FetchedValue, func, text
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

    Rows are soft-deleted so a deletion can be pulled by other devices. `change_seq` is the
    pull cursor: a database trigger sets it from one global sequence on every insert and
    update, so "everything after cursor N" is one indexed range scan per table.
    """

    # The column whose user owns the row; the sync lock is taken for that user.
    __sync_owner__: ClassVar[str] = "user_id"

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(default=1, server_default="1")
    change_seq: Mapped[int] = mapped_column(
        BigInteger,
        server_default=text("nextval('sync_change_seq')"),
        # Set by the trigger on UPDATE too; fetched with RETURNING (eager_defaults).
        server_onupdate=FetchedValue(),
    )

    @property
    def sync_owner_id(self) -> uuid.UUID | None:
        owner: uuid.UUID | None = getattr(self, self.__sync_owner__)
        return owner
