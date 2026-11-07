from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, Response, UploadFile, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.deps import CurrentUser, DbSession, RedisClient, SettingsDep
from app.schemas.portability import DeleteAccount, ImportReport
from app.services import account, portability

router = APIRouter(prefix="/me", tags=["portability"])


@router.get("/export")
async def export_everything(
    user: CurrentUser, session: DbSession, settings: SettingsDep
) -> JSONResponse:
    data: dict[str, Any] = await portability.export_all(session, settings, user, datetime.now(UTC))
    return JSONResponse(
        jsonable_encoder(data),
        headers={"Content-Disposition": 'attachment; filename="repforge-export.json"'},
    )


@router.get("/export/workouts.csv")
async def export_workouts(user: CurrentUser, session: DbSession) -> Response:
    return Response(
        await portability.export_workouts_csv(session, user),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="repforge-workouts.csv"'},
    )


@router.post("/import/workouts", response_model=ImportReport)
async def import_workouts(
    file: Annotated[UploadFile, File()],
    user: CurrentUser,
    session: DbSession,
    redis: RedisClient,
) -> ImportReport:
    data = await file.read(portability.MAX_IMPORT_BYTES + 1)
    return await portability.import_workouts_csv(session, redis, user, data, datetime.now(UTC))


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(body: DeleteAccount, user: CurrentUser, session: DbSession) -> None:
    """Closes the account now; everything is erased within 30 days."""
    await account.close_account(session, user, datetime.now(UTC))
