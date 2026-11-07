"""The Claude client, through the real SDK against replayed responses."""

import logging
from typing import Any

import httpx2
import pytest
from pydantic import BaseModel

from app.ai.client import FALLBACK_BETA, AiClient, AiError, AiRequest, load_prompt
from app.ai.schemas import OverloadExplanation, WeeklyTips
from app.config import Settings
from tests.ai_replay import Replay, canned, fixture, replay_client


class Answer(BaseModel):
    value: int


REQUEST = AiRequest(
    feature="test",
    output=Answer,
    system="Answer.",
    content=[{"type": "text", "text": "Question"}],
)


async def test_a_reply_is_validated_into_the_model() -> None:
    replay = Replay(fixture("weekly_tips"))

    tips = await replay_client(replay).complete(
        AiRequest("weekly_tips", WeeklyTips, "Tips.", [{"type": "text", "text": "Numbers"}])
    )

    assert tips.headline.startswith("Weight is moving")
    assert len(tips.tips) == 3


async def test_the_request_asks_for_schema_json_with_no_sampling_parameters() -> None:
    replay = Replay(canned({"value": 1}))

    await replay_client(replay).complete(REQUEST)

    (body,) = replay.requests
    assert body["model"] == "claude-sonnet-5-5"
    assert body["system"] == "Answer."
    assert body["output_config"]["effort"] == "low"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["format"]["schema"]["additionalProperties"] is False
    assert body["fallbacks"] == "default"
    assert FALLBACK_BETA in replay.headers[0]["anthropic-beta"]
    assert not {"temperature", "top_p", "top_k"} & body.keys()


async def test_an_invalid_reply_is_retried_once_with_the_error() -> None:
    replay = Replay(canned({"value": "many"}), canned({"value": 2}))

    answer = await replay_client(replay).complete(REQUEST)

    assert answer.value == 2
    retry = replay.requests[1]["messages"][0]["content"]
    assert retry[0] == {"type": "text", "text": "Question"}
    assert "rejected" in retry[1]["text"]
    assert "value" in retry[1]["text"]


async def test_a_second_invalid_reply_gives_up() -> None:
    replay = Replay(canned("not json"), canned({"wrong": 1}))

    with pytest.raises(AiError) as caught:
        await replay_client(replay).complete(REQUEST)

    assert caught.value.code == "invalid_output"
    assert replay.replies == []


async def test_a_reply_cut_off_by_max_tokens_counts_as_invalid() -> None:
    replay = Replay(canned('{"val', "max_tokens"), canned({"value": 3}))

    assert (await replay_client(replay).complete(REQUEST)).value == 3


async def test_a_refusal_is_final() -> None:
    replay = Replay(canned("", "refusal"))

    with pytest.raises(AiError) as caught:
        await replay_client(replay).complete(REQUEST)

    assert caught.value.code == "refused"
    assert len(replay.requests) == 1


async def test_the_last_text_block_is_the_answer_after_a_fallback() -> None:
    reply = canned({"value": 4})
    reply["content"] = [{"type": "text", "text": "partial"}, *reply["content"]]

    assert (await replay_client(Replay(reply)).complete(REQUEST)).value == 4


@pytest.mark.parametrize("status", [400, 401, 429, 500])
async def test_api_errors_become_ai_errors(status: int) -> None:
    with pytest.raises(AiError) as caught:
        await replay_client(Replay(status)).complete(REQUEST)

    assert caught.value.code == "api_error"


async def test_an_unreachable_api_becomes_an_ai_error() -> None:
    replay = Replay(httpx2.ConnectError("no route"))

    with pytest.raises(AiError) as caught:
        await replay_client(replay).complete(REQUEST)

    assert caught.value.code == "unreachable"


async def test_without_a_key_nothing_is_sent() -> None:
    client = AiClient(Settings(_env_file=None, anthropic_api_key=""))

    assert client.available is False
    with pytest.raises(AiError) as caught:
        await client.complete(REQUEST)
    assert caught.value.code == "not_configured"
    await client.aclose()


async def test_every_call_logs_its_cost(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.ai.client"):
        await replay_client(Replay(canned({"value": 1}))).complete(REQUEST)

    (record,) = [r for r in caplog.records if r.message == "ai_call"]
    assert record.__dict__["feature"] == "test"
    assert record.__dict__["model"] == "claude-sonnet-5-5"
    assert record.__dict__["input_tokens"] == 100
    assert record.__dict__["output_tokens"] == 20
    assert record.__dict__["latency_ms"] >= 0
    assert record.__dict__["request_id"] == "req_test"


def test_explanations_stay_short() -> None:
    assert OverloadExplanation(explanation="x" * 160)
    with pytest.raises(ValueError, match="160"):
        OverloadExplanation(explanation="x" * 161)


def test_prompts_load_from_disk_and_are_cached(tmp_path: Any, monkeypatch: Any) -> None:
    (tmp_path / "hello.md").write_text("  Hi there.\n", encoding="utf-8")
    monkeypatch.setattr("app.ai.client.PROMPTS", tmp_path)
    load_prompt.cache_clear()

    assert load_prompt("hello") == "Hi there."
    load_prompt.cache_clear()
