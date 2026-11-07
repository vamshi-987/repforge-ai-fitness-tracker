import uuid
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import AiDep, DbSession
from app.schemas.coach import OverloadList, OverloadOut, WeeklyReportOut
from app.schemas.nutrition import TargetsOut
from app.services import coach, overload_coach
from app.services.pro import ProUser

router = APIRouter(tags=["coach"])


@router.get("/coach/weekly-report", response_model=WeeklyReportOut)
async def weekly_report(
    user: ProUser,
    session: DbSession,
    ai: AiDep,
    week: Annotated[date | None, Query()] = None,
) -> WeeklyReportOut:
    return await coach.weekly_report(session, ai, user, week, datetime.now(UTC))


@router.post("/coach/weekly-report/{report_id}/apply", response_model=TargetsOut)
async def apply_weekly_report(
    report_id: uuid.UUID, user: ProUser, session: DbSession
) -> TargetsOut:
    return await coach.apply_report(session, user, report_id, datetime.now(UTC))


@router.get("/coach/overload", response_model=OverloadList)
async def routine_overload(
    routine_id: uuid.UUID, user: ProUser, session: DbSession, ai: AiDep
) -> OverloadList:
    return await overload_coach.for_routine(session, ai, user, routine_id, datetime.now(UTC))


@router.get("/coach/overload/{exercise_id}", response_model=OverloadOut | None)
async def exercise_overload(
    exercise_id: uuid.UUID,
    user: ProUser,
    session: DbSession,
    ai: AiDep,
    rep_min: Annotated[int, Query(ge=1, le=100)] = overload_coach.DEFAULT_REP_RANGE[0],
    rep_max: Annotated[int, Query(ge=1, le=100)] = overload_coach.DEFAULT_REP_RANGE[1],
) -> OverloadOut | None:
    """Null for an exercise with no sessions yet, or one that isn't counted in reps."""
    return await overload_coach.for_exercise(
        session, ai, user, exercise_id, (rep_min, rep_max), datetime.now(UTC)
    )
