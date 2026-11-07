"""Food photo analysis: upload, a background LLM call, and a draft to confirm (CLAUDE.md §3.4).

The API stores the photo and answers 202 at once. A worker reads the photo, and the client polls
for the draft. Nothing becomes a food log here: the app confirms items through the normal logs.
"""

import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AiClient, AiError
from app.ai.food_vision import estimate_photo, to_draft
from app.config import Settings
from app.core.errors import AppError, NotFoundError
from app.db.models import AnalysisStatus, PhotoAnalysis, User
from app.schemas.nutrition import FoodDraft, PhotoAccepted, PhotoAnalysisOut
from app.services.ai_limits import enforce_daily_limit
from app.services.profile import field_error
from app.services.storage import PhotoStore, StorageError, user_prefix

logger = logging.getLogger(__name__)

# Past this a worker has certainly given up, so a poll reports failure instead of waiting on.
ANALYSIS_TIMEOUT = timedelta(minutes=6)

Enqueue = Callable[[uuid.UUID], object]

MEDIA_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def sniff_image(data: bytes) -> str | None:
    """The file extension from the bytes themselves; the client's content type proves nothing."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _unavailable() -> AppError:
    return AppError(
        "ai_unavailable", "Food recognition isn't available right now. Add it by hand.", 503
    )


async def start_analysis(
    session: AsyncSession,
    redis: Redis,
    settings: Settings,
    ai: AiClient,
    store: PhotoStore,
    enqueue: Enqueue,
    user: User,
    data: bytes,
    now: datetime,
) -> PhotoAccepted:
    if not ai.available:
        raise _unavailable()
    if len(data) > settings.ai_photo_max_bytes:
        raise field_error("file", "the photo is larger than 5 MB")
    extension = sniff_image(data)
    if extension is None:
        raise field_error("file", "use a JPEG, PNG or WebP photo")
    await enforce_daily_limit(redis, settings, user, "photo", now)

    analysis_id = uuid.uuid4()
    key = f"{user_prefix(user.id)}{analysis_id}.{extension}"
    try:
        await store.put(key, data, MEDIA_TYPES[extension])
    except StorageError as exc:
        logger.error("photo_store_failed", extra={"error": str(exc)})
        raise _unavailable() from exc
    row = PhotoAnalysis(id=analysis_id, user_id=user.id, object_key=key)
    session.add(row)
    await session.commit()
    try:
        enqueue(analysis_id)
    except Exception as exc:
        # The broker is down: the client hears now, instead of polling a job nobody will run.
        logger.error("photo_enqueue_failed", extra={"error": repr(exc)})
        row.status = AnalysisStatus.FAILED
        row.error = "not_queued"
        await session.commit()
        raise _unavailable() from exc
    return PhotoAccepted(analysis_id=analysis_id)


async def process_analysis(
    session: AsyncSession, ai: AiClient, store: PhotoStore, analysis_id: uuid.UUID
) -> None:
    """The worker's job. Safe to run twice: a redelivered task finds the row finished."""
    row = await session.get(PhotoAnalysis, analysis_id)
    if row is None or row.status != AnalysisStatus.PENDING:
        return
    user = await session.get(User, row.user_id)
    if user is None:
        return
    media_type = MEDIA_TYPES[row.object_key.rsplit(".", 1)[-1]]
    try:
        image = await store.get(row.object_key)
        estimate = await estimate_photo(ai, image, media_type)
        draft = await to_draft(session, user, estimate)
    except AiError as exc:
        row.status = AnalysisStatus.FAILED
        row.error = exc.code
    except StorageError as exc:
        logger.error("photo_read_failed", extra={"error": str(exc)})
        row.status = AnalysisStatus.FAILED
        row.error = "storage"
    else:
        row.status = AnalysisStatus.DONE
        row.result_json = draft.model_dump(mode="json")
        row.model = ai.model
    await session.commit()


async def get_analysis(
    session: AsyncSession, user: User, analysis_id: uuid.UUID, now: datetime
) -> PhotoAnalysisOut:
    row = await session.get(PhotoAnalysis, analysis_id)
    if row is None or row.user_id != user.id:
        raise NotFoundError("Analysis not found")
    if row.status == AnalysisStatus.PENDING and now - row.created_at > ANALYSIS_TIMEOUT:
        row.status = AnalysisStatus.FAILED
        row.error = "timed_out"
        await session.commit()
    return PhotoAnalysisOut(
        id=row.id,
        status=row.status,
        draft=FoodDraft.model_validate(row.result_json) if row.result_json else None,
        error=row.error,
        created_at=row.created_at,
    )
