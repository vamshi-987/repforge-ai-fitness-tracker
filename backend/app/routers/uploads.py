from datetime import UTC, datetime

from fastapi import APIRouter

from app.deps import CurrentUser, SettingsDep
from app.schemas.body import UploadOut, UploadRequest
from app.services.storage import new_upload

router = APIRouter(tags=["uploads"])


@router.post("/uploads/presign", response_model=UploadOut)
async def presign_upload(
    body: UploadRequest, user: CurrentUser, settings: SettingsDep
) -> UploadOut:
    """A signed URL to PUT one file straight into object storage."""
    upload = new_upload(settings, user.id, body.content_type, datetime.now(UTC))
    return UploadOut(
        object_key=upload.object_key,
        upload_url=upload.upload_url,
        headers={"Content-Type": body.content_type},
        expires_at=upload.expires_at,
    )
