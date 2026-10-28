"""The per-user lock that keeps the sync cursor free of gaps.

`change_seq` values are taken from one sequence when a row is written, but a row only becomes
visible when its transaction commits. If two transactions wrote rows for the same user and
committed out of order, a pull running in between would see change 105 before change 104
was visible, move its cursor to 105, and never see 104.

So every transaction that writes a user's syncable rows holds that user's advisory lock
(exclusive, released at commit or rollback), and a pull takes the same lock in shared mode:
it waits until each write in flight for that user has committed, and no new write can start
underneath it. Other users are never blocked.

The `before_flush` hook takes the lock automatically for any syncable row being written, so
a service that forgets cannot break the rule. Services that lock rows (`SELECT ... FOR
UPDATE`) before writing call `lock_changes` first, so every transaction takes the advisory
lock before row locks and two of them can't deadlock on the order.
"""

import uuid
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, SessionTransaction

from app.db.mixins import SyncableMixin

LOCKED_USERS = "sync_locked_users"

_LOCK = text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))")
_LOCK_SHARED = text("SELECT pg_advisory_xact_lock_shared(hashtextextended(:key, 0))")


def lock_key(user_id: uuid.UUID) -> str:
    return f"sync:{user_id}"


def _locked(session: Session) -> set[uuid.UUID]:
    locked: set[uuid.UUID] = session.info.setdefault(LOCKED_USERS, set())
    return locked


async def lock_changes(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Hold the user's write lock until this transaction ends (no-op if already held)."""
    locked = _locked(session.sync_session)
    if user_id not in locked:
        await session.execute(_LOCK, {"key": lock_key(user_id)})
        locked.add(user_id)


async def wait_for_changes(session: AsyncSession, user_id: uuid.UUID) -> None:
    """For pulls: wait until the user's in-flight writes have committed."""
    await session.execute(_LOCK_SHARED, {"key": lock_key(user_id)})


@event.listens_for(Session, "before_flush")
def _lock_before_writing(session: Session, _context: Any, _instances: Any) -> None:
    locked = _locked(session)
    for row in (*session.new, *session.dirty, *session.deleted):
        if not isinstance(row, SyncableMixin):
            continue
        owner = row.sync_owner_id
        if owner is not None and owner not in locked:
            session.connection().execute(_LOCK, {"key": lock_key(owner)})
            locked.add(owner)


@event.listens_for(Session, "after_transaction_end")
def _forget_locks(session: Session, transaction: SessionTransaction) -> None:
    # The database released the locks with the transaction.
    if transaction.parent is None:
        session.info.pop(LOCKED_USERS, None)
