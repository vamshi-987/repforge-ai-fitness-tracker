"""Metrics, Sentry scrubbing and the AI cost report."""

import json
from typing import Any

import pytest
import sentry_sdk
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.commands.ai_costs import call_cost, render, summarize
from app.config import Settings, get_settings
from app.core.sentry import init_sentry, scrub
from app.main import create_app
from tests.ai_replay import Replay, canned, replay_client


@pytest.fixture
def app() -> FastAPI:
    return create_app()


async def get_metrics(
    app: FastAPI, settings: Settings, headers: dict[str, str] | None = None
) -> Any:
    app.dependency_overrides[get_settings] = lambda: settings
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        return await client.get("/metrics", headers=headers or {})


async def test_metrics_use_the_route_template_not_the_path(app: FastAPI) -> None:
    settings = Settings(_env_file=None, environment="dev")
    app.dependency_overrides[get_settings] = lambda: settings
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://t"
    ) as client:
        await client.get("/v1/health")
        await client.get("/v1/users/some-user-name")
        await client.get("/no/such/page")

    body = (await get_metrics(app, settings)).text

    assert 'route="/v1/health",status="200"' in body
    assert 'route="/v1/users/{username}"' in body
    assert "some-user-name" not in body
    assert 'route="unmatched"' in body
    assert 'route="/metrics"' not in body
    assert "repforge_http_request_duration_seconds_bucket" in body


async def test_metrics_are_open_in_dev_without_a_token(app: FastAPI) -> None:
    response = await get_metrics(app, Settings(_env_file=None, environment="dev"))

    assert response.status_code == 200


async def test_metrics_are_off_in_prod_without_a_token(app: FastAPI) -> None:
    settings = Settings(_env_file=None, environment="dev").model_copy(
        update={"environment": "prod"}
    )

    assert (await get_metrics(app, settings)).status_code == 404


async def test_a_metrics_token_is_checked(app: FastAPI) -> None:
    settings = Settings(_env_file=None, environment="dev", metrics_token="secret")

    assert (await get_metrics(app, settings)).status_code == 401
    wrong = await get_metrics(app, settings, {"Authorization": "Bearer guess"})
    right = await get_metrics(app, settings, {"Authorization": "Bearer secret"})

    assert wrong.status_code == 401
    assert right.status_code == 200


async def test_llm_tokens_are_counted(app: FastAPI) -> None:
    from pydantic import BaseModel

    from app.ai.client import AiRequest

    class Answer(BaseModel):
        value: int

    await replay_client(Replay(canned({"value": 1}))).complete(
        AiRequest("metrics_test", Answer, "Answer.", [{"type": "text", "text": "Q"}])
    )

    body = (await get_metrics(app, Settings(_env_file=None, environment="dev"))).text

    assert 'repforge_ai_tokens_total{feature="metrics_test",kind="input"} 100.0' in body
    assert 'repforge_ai_tokens_total{feature="metrics_test",kind="output"} 20.0' in body


def test_sentry_gets_no_bodies_tokens_or_personal_details() -> None:
    event = {
        "request": {
            "url": "http://api/v1/food-logs",
            "data": {"name": "dal"},
            "cookies": {"a": "b"},
            "query_string": "token=abc",
            "headers": {"Authorization": "Bearer x", "User-Agent": "RepForge"},
        },
        "user": {"id": "u1", "email": "a@example.com", "ip_address": "1.2.3.4"},
    }

    cleaned = scrub(event, None)

    assert cleaned["request"] == {
        "url": "http://api/v1/food-logs",
        "headers": {"Authorization": "[hidden]", "User-Agent": "RepForge"},
    }
    assert cleaned["user"] == {"id": "u1"}


def test_scrub_leaves_events_without_a_request_alone() -> None:
    assert scrub({"message": "boom"}, None) == {"message": "boom"}


def test_sentry_stays_off_without_a_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))

    init_sentry(Settings(_env_file=None, sentry_dsn=""))

    assert calls == []


def test_sentry_starts_private_with_a_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))

    init_sentry(Settings(_env_file=None, sentry_dsn="https://k@sentry.example/1"))

    (options,) = calls
    assert options["send_default_pii"] is False
    assert options["before_send"] is scrub


def log(feature: str, day: str = "2026-11-06", **extra: Any) -> str:
    return json.dumps(
        {
            "ts": f"{day}T08:00:00+00:00",
            "message": "ai_call",
            "feature": feature,
            "model": "claude-sonnet-5-5",
            "input_tokens": 1000,
            "output_tokens": 200,
            "latency_ms": 900,
            **extra,
        }
    )


def test_one_call_costs_what_the_price_list_says() -> None:
    # 1000 in at $2 and 200 out at $10 per million.
    assert call_cost("claude-sonnet-5-5", 1000, 200) == pytest.approx(0.004)
    assert call_cost("some-new-model", 1000, 200) == 0


def test_the_report_adds_up_per_day_and_feature() -> None:
    lines = [
        log("food_photo"),
        log("food_photo", latency_ms=1100),
        log("weekly_tips"),
        log("food_photo", day="2026-11-07"),
        '{"message": "request", "path": "/v1/health"}',
        "not json at all",
        "[1, 2]",
    ]

    totals = summarize(lines)

    photos = totals[("2026-11-06", "food_photo")]
    assert (photos.calls, photos.input_tokens, photos.output_tokens) == (2, 2000, 400)
    assert photos.average_latency_ms == 1000
    assert photos.cost_usd == pytest.approx(0.008)
    assert len(totals) == 3
    report = render(totals)
    assert "food_photo" in report
    assert "total 0.0160 USD" in report


def test_an_empty_log_is_an_empty_report() -> None:
    assert render(summarize([])).endswith("total 0.0000 USD")
