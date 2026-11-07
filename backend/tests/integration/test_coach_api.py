"""The weekly report against real tables, with Claude replayed."""

from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.client import AiClient, get_ai_client
from app.ai.coach_tips import CHECK_IN_TIP, FLOOR_TIP
from app.config import Settings
from app.db.models import NutritionTarget, TargetReason, User, WeeklyReport
from app.services import coach
from app.services.library_seed import library_id
from app.services.push import Notification
from tests.ai_replay import Replay, canned, fixture, replay_client
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Sessions = async_sessionmaker[AsyncSession]
Headers = dict[str, str]

TODAY = datetime.now(UTC).date()
THIS_MONDAY = TODAY - timedelta(days=TODAY.weekday())
WEEK = THIS_MONDAY - timedelta(days=7)
PREVIOUS = WEEK - timedelta(days=7)
EARLIER = PREVIOUS - timedelta(days=7)
EMAIL = "lifter@example.com"
BENCH = str(library_id("exercise", "bench-press-barbell"))


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


async def onboard(client: AsyncClient, auth: Headers, **overrides: Any) -> None:
    response = await client.patch(
        "/v1/me/profile",
        headers=auth,
        json={
            "sex": "male",
            "birth_date": "1996-01-15",
            "height_cm": 180,
            "weight_kg": 80,
            "activity_level": "moderate",
            "goal": "muscle_gain",
            "experience": "intermediate",
            "onboarding_complete": True,
            **overrides,
        },
    )
    assert response.status_code == 200, response.text


async def set_targets(client: AsyncClient, auth: Headers, kcal: int = 2800) -> None:
    response = await client.post(
        "/v1/nutrition/targets",
        headers=auth,
        json={"kcal": kcal, "protein_g": 144, "carbs_g": 350, "fat_g": 78},
    )
    assert response.status_code in (200, 201), response.text


async def weigh(client: AsyncClient, auth: Headers, week: date, *weights: float) -> None:
    for offset, weight in enumerate(weights):
        moment = datetime.combine(week + timedelta(days=offset), time(7), tzinfo=UTC)
        response = await client.post(
            "/v1/body/weights",
            headers=auth,
            json={"measured_at": moment.isoformat(), "weight_kg": weight},
        )
        assert response.status_code == 201, response.text


async def eat(client: AsyncClient, auth: Headers, day: date, kcal: float) -> None:
    response = await client.post(
        "/v1/food-logs",
        headers=auth,
        json={
            "log_date": day.isoformat(),
            "meal": "lunch",
            "name": "Meal",
            "per_100g": {"kcal": 500, "protein": 20, "carbs": 50, "fat": 20},
            "quantity": kcal / 5,
            "unit": "g",
            "grams": kcal / 5,
            "source": "manual",
        },
    )
    assert response.status_code == 201, response.text


async def standard_week(client: AsyncClient, auth: Headers) -> None:
    """Averages of 80.0 and then 80.1 kg, for a target gain of 0.3 kg."""
    await onboard(client, auth)
    await set_targets(client, auth)
    await weigh(client, auth, PREVIOUS, 79.9, 80.0, 80.1)
    await weigh(client, auth, WEEK, 80.0, 80.1, 80.2)


async def report(client: AsyncClient, auth: Headers) -> dict[str, Any]:
    response = await client.get("/v1/coach/weekly-report", headers=auth)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_the_report_matches_the_numbers_worked_out_by_hand(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await standard_week(api_client, auth)
    for offset in range(14):
        await eat(api_client, auth, PREVIOUS + timedelta(days=offset), 2500)
    replay.replies.append(fixture("weekly_tips"))

    body = await report(api_client, auth)

    assert body["week_start"] == WEEK.isoformat()
    assert body["status"] == "too_slow"
    assert (body["avg_weight_kg"], body["prev_avg_weight_kg"]) == (80.1, 80.0)
    assert (body["change_kg"], body["rate_pct"]) == (0.1, 0.13)
    assert (body["target_rate_min_pct"], body["target_rate_max_pct"]) == (0.25, 0.5)
    # (0.3 - 0.1) * 7700 / 7 = 220, to the nearest 50.
    assert body["delta_kcal"] == 200
    assert body["current_targets"]["kcal"] == 2800
    assert body["suggested_targets"] == {
        "kcal": 3000,
        "protein_g": 144,
        "carbs_g": 419,
        "fat_g": 83,
    }
    # 2500 - 0.1 * 7700 / 7.
    assert (body["tdee_kcal"], body["tdee_source"]) == (2390, "adaptive")
    assert (body["avg_kcal_logged"], body["avg_protein_g"], body["days_logged"]) == (2500, 100, 7)
    assert body["weigh_ins"] == 3
    assert body["headline"].startswith("Weight is moving")
    assert len(body["tips"]) == 3
    assert body["ai_written"] is True
    assert body["applied"] is False
    assert (body["check_in"], body["floor_hit"]) == (False, False)


async def test_the_llm_sees_numbers_and_nothing_personal(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await standard_week(api_client, auth)
    replay.replies.append(fixture("weekly_tips"))

    await report(api_client, auth)

    (request,) = replay.requests
    sent = request["messages"][0]["content"][0]["text"]
    assert '"new_targets"' in sent
    assert '"workouts_this_week"' in sent
    assert EMAIL not in sent
    assert "1996" not in sent
    assert "medical" in request["system"]


async def test_without_an_api_key_the_numbers_stand_with_template_tips(
    api_client: AsyncClient, auth: Headers, app: FastAPI, test_settings: Settings
) -> None:
    await standard_week(api_client, auth)
    client = AiClient(test_settings.model_copy(update={"anthropic_api_key": ""}))
    app.dependency_overrides[get_ai_client] = lambda: client

    body = await report(api_client, auth)

    assert body["suggested_targets"]["kcal"] == 3000
    assert body["headline"] == "Your weight moved slower than planned this week."
    assert len(body["tips"]) == 2
    assert body["ai_written"] is False


async def test_a_failing_llm_gives_the_same_card(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await standard_week(api_client, auth)
    replay.replies.extend([canned("nonsense"), canned("nonsense")])

    body = await report(api_client, auth)

    assert body["suggested_targets"]["kcal"] == 3000
    assert body["ai_written"] is False


async def test_a_report_is_written_once(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await standard_week(api_client, auth)
    replay.replies.append(fixture("weekly_tips"))

    first = await report(api_client, auth)
    again = await report(api_client, auth)

    assert again == first
    assert len(replay.requests) == 1


async def test_nothing_changes_until_the_report_is_applied(
    api_client: AsyncClient, auth: Headers, replay: Replay, session_factory: Sessions
) -> None:
    await standard_week(api_client, auth)
    replay.replies.append(fixture("weekly_tips"))
    body = await report(api_client, auth)

    before = await api_client.get("/v1/nutrition/targets", headers=auth)
    assert before.json()["kcal"] == 2800

    applied = await api_client.post(f"/v1/coach/weekly-report/{body['id']}/apply", headers=auth)

    assert applied.status_code == 200, applied.text
    assert applied.json()["kcal"] == 3000
    assert applied.json()["reason"] == "weekly_adjustment"
    assert (await report(api_client, auth))["applied"] is True

    twice = await api_client.post(f"/v1/coach/weekly-report/{body['id']}/apply", headers=auth)
    assert twice.json()["kcal"] == 3000
    async with session_factory() as session:
        rows = list(await session.scalars(select(NutritionTarget)))
    assert [r.reason for r in rows] == [TargetReason.WEEKLY_ADJUSTMENT]


@pytest.mark.parametrize("weights", [(80.0,), (80.0, 80.2)])
async def test_too_few_weigh_ins_say_so_without_asking_the_llm(
    api_client: AsyncClient, auth: Headers, replay: Replay, weights: tuple[float, ...]
) -> None:
    await onboard(api_client, auth)
    await weigh(api_client, auth, PREVIOUS, 79.9, 80.0, 80.1)
    await weigh(api_client, auth, WEEK, *weights)

    body = await report(api_client, auth)

    assert body["status"] == "insufficient_data"
    assert body["headline"].startswith("Log more weigh-ins")
    assert body["weigh_ins"] == len(weights)
    assert (body["rate_pct"], body["suggested_targets"]) == (None, None)
    assert body["tdee_kcal"] is None
    assert replay.requests == []


async def test_a_report_short_of_data_fills_in_once_the_data_arrives(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await standard_week(api_client, auth)
    await weigh(api_client, auth, EARLIER, 79.0)
    other = await api_client.get(
        f"/v1/coach/weekly-report?week={PREVIOUS.isoformat()}", headers=auth
    )
    assert other.json()["status"] == "insufficient_data"

    await weigh(api_client, auth, EARLIER + timedelta(days=1), 79.0, 79.0)
    replay.replies.append(fixture("weekly_tips"))
    filled = await api_client.get(
        f"/v1/coach/weekly-report?week={PREVIOUS.isoformat()}", headers=auth
    )

    assert filled.json()["id"] == other.json()["id"]
    assert filled.json()["status"] == "too_fast"


async def test_weigh_ins_without_a_profile_give_no_burn_estimate(
    api_client: AsyncClient, auth: Headers
) -> None:
    await weigh(api_client, auth, WEEK, 80.0, 80.1, 80.2)

    body = await report(api_client, auth)

    assert body["avg_weight_kg"] is None or body["status"] == "insufficient_data"
    assert (body["tdee_kcal"], body["tdee_source"]) == (None, None)


async def test_a_report_without_targets_has_nothing_to_apply(
    api_client: AsyncClient, auth: Headers
) -> None:
    body = await report(api_client, auth)

    assert body["status"] == "insufficient_data"
    assert (body["target_rate_min_pct"], body["target_rate_max_pct"]) == (0, 0)
    assert body["current_targets"] is None
    response = await api_client.post(f"/v1/coach/weekly-report/{body['id']}/apply", headers=auth)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "report_has_no_targets"


async def test_a_week_of_very_low_intake_is_a_check_in_not_a_cut(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await onboard(api_client, auth, goal="fat_loss")
    await set_targets(api_client, auth, 2400)
    await weigh(api_client, auth, PREVIOUS, 80.0, 80.0, 80.0)
    await weigh(api_client, auth, WEEK, 80.0, 80.0, 80.0)
    for offset in range(7):
        await eat(api_client, auth, WEEK + timedelta(days=offset), 900)
    replay.replies.append(fixture("weekly_tips"))

    body = await report(api_client, auth)

    assert body["check_in"] is True
    assert body["delta_kcal"] == 0
    assert body["tips"][0] == CHECK_IN_TIP
    assert '"check_in": true' in replay.requests[0]["messages"][0]["content"][0]["text"]


async def test_two_weeks_of_fast_loss_is_a_check_in(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await onboard(api_client, auth, goal="fat_loss")
    await set_targets(api_client, auth, 2400)
    await weigh(api_client, auth, EARLIER, 84.0, 84.0, 84.0)
    await weigh(api_client, auth, PREVIOUS, 82.0, 82.0, 82.0)
    await weigh(api_client, auth, WEEK, 80.0, 80.0, 80.0)
    replay.replies.append(fixture("weekly_tips"))

    body = await report(api_client, auth)

    assert body["check_in"] is True
    assert body["status"] == "too_fast"
    assert body["tips"][0] == CHECK_IN_TIP


async def test_low_intake_shows_even_without_enough_weigh_ins(
    api_client: AsyncClient, auth: Headers
) -> None:
    await onboard(api_client, auth)
    for offset in range(7):
        await eat(api_client, auth, WEEK + timedelta(days=offset), 800)

    body = await report(api_client, auth)

    assert body["status"] == "insufficient_data"
    assert body["check_in"] is True
    assert body["tips"][0] == CHECK_IN_TIP


async def test_the_safety_floor_holds_and_tips_say_slow_down(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await onboard(api_client, auth, goal="fat_loss")
    # BMR here is about 1780, so the floor is 1800.
    await set_targets(api_client, auth, 1850)
    await weigh(api_client, auth, PREVIOUS, 80.0, 80.0, 80.0)
    await weigh(api_client, auth, WEEK, 80.0, 80.0, 80.0)
    replay.replies.append(fixture("weekly_tips"))

    body = await report(api_client, auth)

    assert body["suggested_targets"]["kcal"] == 1800
    assert body["floor_hit"] is True
    assert body["tips"][0] == FLOOR_TIP


async def test_tdee_is_estimated_until_enough_days_are_logged(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await standard_week(api_client, auth)
    await eat(api_client, auth, WEEK, 2500)
    replay.replies.append(fixture("weekly_tips"))

    body = await report(api_client, auth)

    assert body["tdee_source"] == "estimate"
    assert 2500 < body["tdee_kcal"] < 3000


async def test_workouts_of_the_week_are_counted(
    api_client: AsyncClient, auth: Headers, replay: Replay
) -> None:
    await standard_week(api_client, auth)
    started = datetime.combine(WEEK + timedelta(days=2), time(18), tzinfo=UTC)
    response = await api_client.put(
        "/v1/workouts/00000000-0000-4000-8000-000000000001",
        headers=auth,
        json={
            "title": "Push",
            "started_at": started.isoformat(),
            "ended_at": (started + timedelta(hours=1)).isoformat(),
            "exercises": [{"exercise_id": BENCH, "sets": [{"weight_kg": 60, "reps": 8}]}],
        },
    )
    assert response.status_code in (200, 201), response.text
    replay.replies.append(fixture("weekly_tips"))

    assert (await report(api_client, auth))["workouts"] == 1


async def test_the_coach_is_pro(api_client: AsyncClient) -> None:
    free = bearer(await register_user(api_client, "free@example.com"))

    response = await api_client.get("/v1/coach/weekly-report", headers=free)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "pro_required"


@pytest.mark.parametrize("week", [WEEK + timedelta(days=1), THIS_MONDAY])
async def test_a_week_must_be_a_finished_monday(
    api_client: AsyncClient, auth: Headers, week: date
) -> None:
    response = await api_client.get(
        f"/v1/coach/weekly-report?week={week.isoformat()}", headers=auth
    )

    assert response.status_code == 422


async def test_another_users_report_cant_be_applied(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions
) -> None:
    body = await report(api_client, auth)
    other_email = "other@example.com"
    other = bearer(await register_user(api_client, other_email))
    async with session_factory() as session:
        await session.execute(update(User).where(User.email == other_email).values(is_pro=True))
        await session.commit()

    response = await api_client.post(f"/v1/coach/weekly-report/{body['id']}/apply", headers=other)

    assert response.status_code == 404


async def test_a_race_for_the_same_report_keeps_the_first(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = await report(api_client, auth)
    real = coach._existing
    calls = 0

    async def blind_at_first(*args: Any) -> WeeklyReport | None:
        nonlocal calls
        calls += 1
        return None if calls <= 2 else await real(*args)

    monkeypatch.setattr(coach, "_existing", blind_at_first)
    async with session_factory() as session:
        user = await session.scalar(select(User).where(User.email == EMAIL))
        assert user is not None
        ai = replay_client(Replay(), test_settings)
        out = await coach.weekly_report(session, ai, user, None, datetime.now(UTC))

    assert str(out.id) == first["id"]


async def test_the_hourly_job_writes_reports_for_pro_users_at_monday_six(
    api_client: AsyncClient, auth: Headers, session_factory: Sessions, test_settings: Settings
) -> None:
    await register_user(api_client, "free@example.com")
    ai = replay_client(Replay(), test_settings)
    monday = datetime.combine(THIS_MONDAY, time(6, 5), tzinfo=UTC)
    sent: list[Notification] = []

    async with session_factory() as session:
        done = await coach.generate_due_reports(session, ai, monday, sent.append)
        later = await coach.generate_due_reports(
            session, ai, monday + timedelta(hours=1), sent.append
        )
        rows = list(await session.scalars(select(WeeklyReport)))

    assert (done, later) == (1, 0)
    assert [r.week_start for r in rows] == [WEEK]
    # A report that only asks for more weigh-ins isn't worth a push.
    assert sent == []


async def test_one_users_failure_doesnt_stop_the_job(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def broken(*args: Any) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(coach, "weekly_report", broken)
    monday = datetime.combine(THIS_MONDAY, time(6, 5), tzinfo=UTC)

    async with session_factory() as session:
        done = await coach.generate_due_reports(
            session, replay_client(Replay(), test_settings), monday, lambda _: None
        )

    assert done == 0


async def test_a_finished_report_sends_a_push(
    api_client: AsyncClient,
    auth: Headers,
    session_factory: Sessions,
    replay: Replay,
    test_settings: Settings,
) -> None:
    await standard_week(api_client, auth)
    replay.replies.append(fixture("weekly_tips"))
    monday = datetime.combine(THIS_MONDAY, time(6, 5), tzinfo=UTC)
    sent: list[Notification] = []

    async with session_factory() as session:
        await coach.generate_due_reports(
            session, replay_client(replay, test_settings), monday, sent.append
        )

    (push,) = sent
    assert push.title == "Your weekly report is ready"
    assert push.body.startswith("Weight is moving")
    assert push.path == "/coach/weekly"
