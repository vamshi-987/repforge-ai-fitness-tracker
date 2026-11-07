import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Response, status

from app.deps import CurrentUser, DbSession, SettingsDep
from app.schemas.routines import (
    FolderCreate,
    FolderOut,
    FolderReorder,
    FolderUpdate,
    RoutineCreate,
    RoutineDuplicate,
    RoutineList,
    RoutineOut,
    RoutineReorder,
    RoutineUpdate,
)
from app.services import routines as routine_service
from app.services.routines import routine_limit

router = APIRouter(tags=["routines"])


# --- routines ---------------------------------------------------------------------------


@router.get("/routines", response_model=RoutineList)
async def list_routines(
    user: CurrentUser, session: DbSession, settings: SettingsDep
) -> RoutineList:
    return await routine_service.list_routines(session, user, routine_limit(user, settings))


@router.post("/routines", response_model=RoutineOut, status_code=status.HTTP_201_CREATED)
async def create_routine(
    body: RoutineCreate, user: CurrentUser, session: DbSession, settings: SettingsDep
) -> RoutineOut:
    return await routine_service.create_routine(session, user, body, routine_limit(user, settings))


@router.post("/routines/reorder", response_model=RoutineList)
async def reorder_routines(
    body: RoutineReorder, user: CurrentUser, session: DbSession, settings: SettingsDep
) -> RoutineList:
    return await routine_service.reorder_routines(
        session, user, body, routine_limit(user, settings)
    )


@router.get("/routines/{routine_id}", response_model=RoutineOut)
async def get_routine(routine_id: uuid.UUID, user: CurrentUser, session: DbSession) -> RoutineOut:
    return await routine_service.get_routine(session, user, routine_id)


@router.patch("/routines/{routine_id}", response_model=RoutineOut)
async def update_routine(
    routine_id: uuid.UUID, body: RoutineUpdate, user: CurrentUser, session: DbSession
) -> RoutineOut:
    return await routine_service.update_routine(session, user, routine_id, body)


@router.delete("/routines/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_routine(routine_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await routine_service.delete_routine(session, user, routine_id, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/routines/{routine_id}/duplicate",
    response_model=RoutineOut,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_routine(
    routine_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    settings: SettingsDep,
    body: RoutineDuplicate | None = None,
) -> RoutineOut:
    return await routine_service.duplicate_routine(
        session, user, routine_id, body or RoutineDuplicate(), routine_limit(user, settings)
    )


# --- folders ----------------------------------------------------------------------------


@router.get("/routine-folders", response_model=list[FolderOut])
async def list_folders(user: CurrentUser, session: DbSession) -> list[FolderOut]:
    return await routine_service.list_folders(session, user)


@router.post("/routine-folders", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
async def create_folder(body: FolderCreate, user: CurrentUser, session: DbSession) -> FolderOut:
    return await routine_service.create_folder(session, user, body)


@router.post("/routine-folders/reorder", response_model=list[FolderOut])
async def reorder_folders(
    body: FolderReorder, user: CurrentUser, session: DbSession
) -> list[FolderOut]:
    return await routine_service.reorder_folders(session, user, body)


@router.patch("/routine-folders/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: uuid.UUID, body: FolderUpdate, user: CurrentUser, session: DbSession
) -> FolderOut:
    return await routine_service.update_folder(session, user, folder_id, body)


@router.delete("/routine-folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(folder_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await routine_service.delete_folder(session, user, folder_id, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
