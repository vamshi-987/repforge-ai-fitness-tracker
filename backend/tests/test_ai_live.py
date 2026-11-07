"""One real call, for a person with a key: RUN_LIVE_AI=1 pytest tests/test_ai_live.py -m live"""

import os

import pytest

from app.ai.client import AiClient, AiRequest
from app.ai.schemas import OverloadExplanation
from app.config import get_settings

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.environ.get("RUN_LIVE_AI") != "1", reason="set RUN_LIVE_AI=1 to spend"),
]


async def test_claude_answers_in_the_schema() -> None:
    client = AiClient(get_settings())
    assert client.available, "ANTHROPIC_API_KEY is not set"

    answer = await client.complete(
        AiRequest(
            "smoke",
            OverloadExplanation,
            "Explain a gym suggestion in one short sentence.",
            [{"type": "text", "text": "All sets hit 12 reps at RPE 7, so add 2.5 kg."}],
        )
    )

    assert answer.explanation
    await client.aclose()
