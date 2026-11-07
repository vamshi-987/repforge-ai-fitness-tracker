"""The overload coach over real workouts, with Claude replayed."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.client import AiClient, get_ai_client
from app.config import Settings
from app.db.models import OverloadRule, OverloadSuggestion, User
from app.services.library_seed import library_id
from tests.ai_replay import Replay, canned, replay_client
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Sessions = async_sessionmaker[AsyncSession]
Headers = dict[str, str]

EMAIL = "lifter@example.com"
BENCH = str(library_id("exercise", "bench-press-barbell"))
PULLUP = str(library_id("exercise", "pull-up"))
PLANK = str(library_id("exercise", "plank"))
WHY = {"explanation": "You owned every set, so it's time to add weight."}


@pytest.fixture
def replay() -> Replay:
    return Replay()


@pytest.fixture
async def auth(
    api_client: AsyncClient,
    app: FastAPI,
    session_factory: Sessions,
    replay: Replay,
    test_settings: Settings,
) -> AsyncIterator[Headers]:
    client = replay_client(replay, test_settings)
    app.dependency_overrides[get_ai_client] = lambda: client
    headers = bearer(await register_user(api_client, EMAIL))
    async with session_factory() as session:
        await session.execute(update(User).where(User.email == EMAIL).values(is_pro=True))
        await session.commit()
    yield headers


async def workout(
    client: AsyncClient,
    auth: Headers,
    sets: list[dict[str, Any]],
    days_ago: float = 1,
    exercise: str = BENCH,
) -> None:
    ended = datetime.now(UTC) - timedelta(days=days_ago)
    response = await client.put(
        f"/v1/workouts/{uuid.uuid4()}",
        headers=auth,
        json={
            "title": "Push",
            "started_at": (ended - timedelta(hours=1)).isoformat(),
            "ended_at": ended.isoformat(),
            "exercises": [{"exercise_id": exercise, "sets": sets}],
        },
    )
    assert response.status_code in (200, 201), response.text


def top_sets(weight: float = 60, reps: int = 12, count: int = 3) -> list[dict[str, Any]]:
    return [{"weight_kg": weight, "reps": reps, "rpe": 8} for _ in range(count)]


async def routine(client: AsyncClient, auth: Headers, *exercises: dict[str, Any]) -> str:
    response = await client.post(
        "/v1/routines",
        headers=auth,
        json={"name": "Push", "exercises": list(exercises)},
    )
    assert response.status_code == 201, response.text
    routine_id: str = response.json()["id"]
    return routine_id


def bench_entry(**extra: Any) -> dict[str, Any]:
    return {"exercise_id": BENCH, "sets": [{}], **extra}


async def overload(client: AsyncClient, auth: Headers, exercise: str = BENCH) -> Any:
    response = await client.get(f"/v1/coach/overload/{exercise}", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_full_session_earns_more_weight_with_a_reason(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await workout(api_client, auth, top_sets())
    replay.replies.append(canned(WHY))

    body = await overload(api_client, auth)

    assert body["rule"] == "increase_weight"
    assert body["sets"] == [{"weight_kg": 62.5, "reps": 8}] * 3
    assert (body["rep_min"], body["rep_max"]) == (8, 12)
    assert body["e1rm_kg"] == 84
    assert body["e1rm_low_accuracy"] is False
    assert body["explanation"] == WHY["explanation"]


async def test_the_llm_gets_the_decision_and_the_last_three_sessions_only(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    for days in (9, 7, 5, 3):
        await workout(api_client, auth, top_sets(reps=10), days_ago=days)
    replay.replies.append(canned(WHY))

    await overload(api_client, auth)

    sent = replay.requests[0]["messages"][0]["content"][0]["text"]
    assert '"rule": "deload"' in sent
    # Three sessions of three sets, and the two sets of the target.
    assert sent.count('"reps": 10') == 3 * 3 + 2
    assert EMAIL not in sent


async def test_warm_ups_drops_and_unfinished_sets_dont_count(
    api_client: AsyncClient, auth: Headers
) -> None:
    await workout(
        api_client,
        auth,
        [
            {"set_type": "warmup", "weight_kg": 20, "reps": 5},
            *top_sets(count=2),
            {"set_type": "drop", "weight_kg": 40, "reps": 4},
            {"weight_kg": 60, "reps": 3, "completed": False},
        ],
    )

    body = await overload(api_client, auth)

    assert body["rule"] == "increase_weight"
    assert len(body["sets"]) == 2


async def test_without_a_key_the_target_stands_with_a_template_reason(
    api_client: AsyncClient, auth: Headers, app: FastAPI, test_settings: Settings
) -> None:
    await workout(api_client, auth, top_sets())
    client = AiClient(test_settings.model_copy(update={"anthropic_api_key": ""}))
    app.dependency_overrides[get_ai_client] = lambda: client

    body = await overload(api_client, auth)

    assert body["sets"][0]["weight_kg"] == 62.5
    assert body["explanation"].startswith("You hit the top of the range")


async def test_a_failing_llm_falls_back_too(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await workout(api_client, auth, top_sets())
    replay.replies.extend([canned({"explanation": "x" * 161}), canned("nonsense")])

    assert (await overload(api_client, auth))["explanation"].startswith("You hit the top")


async def test_a_suggestion_stands_until_the_next_session(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await workout(api_client, auth, top_sets())
    replay.replies.append(canned(WHY))

    first = await overload(api_client, auth)
    again = await overload(api_client, auth)

    assert again == first
    assert len(replay.requests) == 1

    await workout(api_client, auth, top_sets(62.5, 9), days_ago=0)
    replay.replies.append(canned(WHY))
    after = await overload(api_client, auth)

    assert after["rule"] == "add_reps"
    assert len(replay.requests) == 2


async def test_a_different_rep_range_is_a_new_suggestion(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await workout(api_client, auth, top_sets(reps=8))
    replay.replies.extend([canned(WHY), canned(WHY)])

    assert (await overload(api_client, auth))["rule"] == "add_reps"
    response = await api_client.get(f"/v1/coach/overload/{BENCH}?rep_min=5&rep_max=8", headers=auth)

    assert response.json()["rule"] == "increase_weight"
    assert response.json()["sets"][0]["reps"] == 5


async def test_a_plateau_deloads_then_suggests_a_swap(
    api_client: AsyncClient, auth: Headers, replay: Replay, session_factory: Sessions
) -> None:
    await workout(api_client, auth, top_sets(reps=10), days_ago=9)
    for days in (7, 5, 3):
        await workout(api_client, auth, top_sets(reps=9), days_ago=days)
    replay.replies.extend([canned(WHY), canned(WHY)])

    deload = await overload(api_client, auth)
    assert deload["rule"] == "deload"
    assert deload["sets"] == [{"weight_kg": 52.5, "reps": 9}] * 2

    await workout(api_client, auth, top_sets(reps=9), days_ago=0)
    swap = await overload(api_client, auth)

    assert swap["rule"] == "swap"
    async with session_factory() as session:
        rows = list(await session.scalars(select(OverloadSuggestion.rule)))
    assert sorted(rows) == [OverloadRule.DELOAD, OverloadRule.SWAP]


async def test_lb_users_get_pounds_they_can_load(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await api_client.patch("/v1/me/profile", headers=auth, json={"unit_weight": "lb"})
    await workout(api_client, auth, top_sets(61.23))
    replay.replies.append(canned(WHY))

    assert (await overload(api_client, auth))["sets"][0]["weight_kg"] == 63.5


async def test_bodyweight_exercises_progress_by_reps(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await workout(api_client, auth, [{"reps": 12}, {"reps": 12}], exercise=PULLUP)
    replay.replies.append(canned(WHY))

    body = await overload(api_client, auth, PULLUP)

    assert body["sets"] == [{"weight_kg": None, "reps": 13}] * 2
    assert body["e1rm_kg"] is None


async def test_no_history_means_no_suggestion(api_client: AsyncClient, auth: Headers) -> None:
    assert await overload(api_client, auth) is None


async def test_timed_exercises_get_no_suggestion(api_client: AsyncClient, auth: Headers) -> None:
    await workout(api_client, auth, [{"duration_s": 60}], exercise=PLANK)

    assert await overload(api_client, auth, PLANK) is None


async def test_deleted_workouts_dont_count(api_client: AsyncClient, auth: Headers) -> None:
    await workout(api_client, auth, top_sets())
    listed = (await api_client.get("/v1/workouts", headers=auth)).json()["items"]
    await api_client.delete(f"/v1/workouts/{listed[0]['id']}", headers=auth)

    assert await overload(api_client, auth) is None


async def test_a_routine_uses_its_own_rep_ranges(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await workout(api_client, auth, top_sets(reps=8))
    await workout(api_client, auth, [{"reps": 12}], exercise=PULLUP, days_ago=2)
    routine_id = await routine(
        api_client,
        auth,
        bench_entry(rep_range_min=5, rep_range_max=8),
        bench_entry(rep_range_min=10, rep_range_max=15),
        {"exercise_id": PULLUP, "sets": [{}]},
    )
    replay.replies.extend([canned(WHY), canned(WHY)])

    response = await api_client.get(f"/v1/coach/overload?routine_id={routine_id}", headers=auth)

    assert response.status_code == 200, response.text
    bench, pullup = response.json()["items"]
    assert bench["exercise_id"] == BENCH
    assert bench["rule"] == "increase_weight"
    assert (bench["rep_min"], bench["rep_max"]) == (5, 8)
    assert pullup["exercise_id"] == PULLUP
    assert (pullup["rep_min"], pullup["rep_max"]) == (8, 12)


async def test_a_routine_skips_exercises_never_done(api_client: AsyncClient, auth: Headers) -> None:
    routine_id = await routine(api_client, auth, bench_entry())

    response = await api_client.get(f"/v1/coach/overload?routine_id={routine_id}", headers=auth)

    assert response.json() == {"items": []}


async def test_the_coach_is_pro(api_client: AsyncClient) -> None:
    free = bearer(await register_user(api_client, "free@example.com"))

    response = await api_client.get(f"/v1/coach/overload/{BENCH}", headers=free)

    assert response.status_code == 403


async def test_unknown_things_are_404s(api_client: AsyncClient, auth: Headers) -> None:
    exercise = await api_client.get(f"/v1/coach/overload/{uuid.uuid4()}", headers=auth)
    other_routine = await api_client.get(
        f"/v1/coach/overload?routine_id={uuid.uuid4()}", headers=auth
    )

    assert exercise.status_code == 404
    assert other_routine.status_code == 404


async def test_the_weekly_report_hears_how_the_lifts_went(
    api_client: AsyncClient, auth: Headers, replay: Replay, session_factory: Sessions
) -> None:
    today = datetime.now(UTC).date()
    week = today - timedelta(days=today.weekday() + 7)
    async with session_factory() as session:
        user = await session.scalar(select(User).where(User.email == EMAIL))
        assert user is not None
        session.add(
            OverloadSuggestion(
                user_id=user.id,
                exercise_id=uuid.UUID(BENCH),
                generated_at=datetime(week.year, week.month, week.day, 12, tzinfo=UTC),
                rule=OverloadRule.INCREASE_WEIGHT,
                target_json={},
                explanation="",
            )
        )
        await session.commit()
    await api_client.patch(
        "/v1/me/profile",
        headers=auth,
        json={
            "sex": "male",
            "birth_date": "1996-01-15",
            "height_cm": 180,
            "weight_kg": 80,
            "activity_level": "moderate",
            "goal": "maintain",
            "experience": "intermediate",
            "onboarding_complete": True,
        },
    )
    for monday in (week - timedelta(days=7), week):
        for offset in range(3):
            moment = datetime(monday.year, monday.month, monday.day, 7, tzinfo=UTC)
            await api_client.post(
                "/v1/body/weights",
                headers=auth,
                json={
                    "measured_at": (moment + timedelta(days=offset)).isoformat(),
                    "weight_kg": 80,
                },
            )
    replay.replies.append(canned({"headline": "Steady.", "tips": ["Keep going."]}))

    response = await api_client.get("/v1/coach/weekly-report", headers=auth)

    assert response.status_code == 200, response.text
    sent = replay.requests[0]["messages"][0]["content"][0]["text"]
    assert '"lift_progress": {"increase_weight": 1}' in sent
