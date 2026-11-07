"""Closing an account (CLAUDE.md §13). It stops working at once and is erased within 30 days:
a daily job removes the rows and the stored photos 28 days later."""

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import (
    PersonalRecord,
    PhotoAnalysis,
    ProgressPhoto,
    PushToken,
    RefreshToken,
    Routine,
    SavedMeal,
    User,
    Workout,
)
from app.services.storage import ObjectRemover, StorageError

logger = logging.getLogger(__name__)

PURGE_AFTER = timedelta(days=28)


async def close_account(session: AsyncSession, user: User, now: datetime) -> None:
    """No more sign-ins, no more pushes, and gone from other people's feeds right away."""
    user.deleted_at = now
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await session.execute(delete(PushToken).where(PushToken.user_id == user.id))
    await session.commit()


async def _stored_objects(
    session: AsyncSession, settings: Settings, user: User
) -> list[tuple[str, str]]:
    progress = await session.scalars(
        select(ProgressPhoto.object_key).where(ProgressPhoto.user_id == user.id)
    )
    food = await session.scalars(
        select(PhotoAnalysis.object_key).where(PhotoAnalysis.user_id == user.id)
    )
    return [
        *((settings.s3_bucket_progress_photos, key) for key in progress),
        *((settings.s3_bucket_food_photos, key) for key in food),
    ]


async def _erase(
    session: AsyncSession, settings: Settings, store: ObjectRemover, user: User
) -> None:
    for bucket, key in await _stored_objects(session, settings, user):
        await store.remove(bucket, key)
    # Their custom exercises and foods are held by RESTRICT keys from these, so these go first;
    # everything else follows the user through ON DELETE CASCADE.
    for table in (Workout, PersonalRecord, Routine, SavedMeal):
        await session.execute(delete(table).where(table.user_id == user.id))
    await session.execute(delete(User).where(User.id == user.id))
    await session.commit()


async def purge_closed_accounts(
    session: AsyncSession, settings: Settings, store: ObjectRemover, now: datetime
) -> int:
    """The daily job. If storage is down the account waits for tomorrow, so no photo is left
    behind without a record of it."""
    due = list(await session.scalars(select(User).where(User.deleted_at <= now - PURGE_AFTER)))
    erased = 0
    for user in due:
        user_id = str(user.id)
        try:
            await _erase(session, settings, store, user)
            erased += 1
        except StorageError as exc:
            logger.error("account_purge_failed", extra={"user_id": user_id, "error": str(exc)})
            await session.rollback()
    return erased
