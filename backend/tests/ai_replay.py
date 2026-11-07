"""Replays Claude API responses through the real SDK, so nothing in CI calls the API.

Fixtures in tests/fixtures/ai are response bodies of `POST /v1/messages`. `canned` builds one
around an answer for tests that only care about the JSON the model returned.
"""

import json
from pathlib import Path
from typing import Any

import anthropic
import httpx2

from app.ai.client import AiClient
from app.config import Settings

FIXTURES = Path(__file__).parent / "fixtures" / "ai"


def fixture(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    return loaded


def canned(answer: object, stop_reason: str = "end_turn") -> dict[str, Any]:
    text = answer if isinstance(answer, str) else json.dumps(answer)
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 100, "output_tokens": 20},
    }


class Replay:
    """Answers each request with the next reply: a body, an int for that HTTP status, or an
    exception to raise."""

    def __init__(self, *replies: dict[str, Any] | int | Exception) -> None:
        self.replies = list(replies)
        self.requests: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(json.loads(request.content))
        self.headers.append(dict(request.headers))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, int):
            body = {"type": "error", "error": {"type": "api_error", "message": "Replayed"}}
            return httpx2.Response(reply, json=body)
        return httpx2.Response(200, json=reply, headers={"request-id": "req_test"})


def replay_client(replay: Replay, settings: Settings | None = None) -> AiClient:
    base = settings or Settings(_env_file=None)
    configured = base.model_copy(update={"anthropic_api_key": "test-key", "ai_max_retries": 0})
    transport = httpx2.MockTransport(replay)
    return AiClient(configured, anthropic.DefaultAsyncHttpxClient(transport=transport))
