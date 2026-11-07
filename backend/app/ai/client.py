"""The one place that talks to Claude.

Every call asks for JSON matching a Pydantic model and validates what comes back. A reply that
doesn't validate is retried once with the error appended; after that the caller gets `AiError`
and uses its fallback. Network and server errors are retried by the SDK (exponential backoff).
Sampling parameters aren't sent: `claude-sonnet-5-5` accepts only their defaults.
"""

import logging
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import anthropic
from pydantic import BaseModel, ValidationError

from app.config import Settings, get_settings
from app.core.metrics import AI_TOKENS

logger = logging.getLogger(__name__)

PROMPTS = Path(__file__).parent / "prompts"
# Thinking shares this budget, so it is set well above the JSON's size.
MAX_TOKENS = 16_000
# On a safety decline in a category it covers, the API re-runs the request on another model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

Effort = Literal["low", "medium", "high"]


class AiError(Exception):
    """The LLM gave nothing usable. `code` says why; callers fall back either way."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class _InvalidReplyError(Exception):
    """A reply that failed validation; the text goes back to the model."""


@lru_cache
def load_prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8").strip()


@dataclass(frozen=True)
class AiRequest[Model: BaseModel]:
    feature: str
    output: type[Model]
    system: str
    content: list[dict[str, Any]]
    effort: Effort = "low"


def _reply_text(message: Any) -> str:
    """The answer. After a fallback the reply holds a block per model, and the last one counts."""
    texts = [block.text for block in message.content if block.type == "text"]
    return texts[-1] if texts else ""


class AiClient:
    def __init__(self, settings: Settings, http_client: Any = None) -> None:
        self.model = settings.ai_model
        self.available = bool(settings.anthropic_api_key)
        self._client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key or "unset",
            timeout=settings.ai_timeout_s,
            max_retries=settings.ai_max_retries,
            http_client=http_client,
        )

    async def aclose(self) -> None:
        await self._client.close()

    async def complete[Model: BaseModel](self, request: AiRequest[Model]) -> Model:
        if not self.available:
            raise AiError("not_configured")
        schema = anthropic.transform_schema(request.output)
        try:
            return await self._attempt(request, schema, request.content)
        except _InvalidReplyError as first:
            retry = {
                "type": "text",
                "text": f"Your last answer was rejected: {first}. Answer again with valid JSON.",
            }
            try:
                return await self._attempt(request, schema, [*request.content, retry])
            except _InvalidReplyError as second:
                logger.warning(
                    "ai_invalid_output", extra={"feature": request.feature, "error": str(second)}
                )
                raise AiError("invalid_output") from second

    async def _attempt[Model: BaseModel](
        self, request: AiRequest[Model], schema: dict[str, Any], content: list[dict[str, Any]]
    ) -> Model:
        message = await self._send(request, schema, content)
        if message.stop_reason == "refusal":
            raise AiError("refused")
        try:
            return request.output.model_validate_json(_reply_text(message))
        except ValidationError as exc:
            first = exc.errors(include_input=False, include_url=False)[0]
            raise _InvalidReplyError(f"{first['loc']}: {first['msg']}") from exc

    async def _send(
        self, request: AiRequest[Any], schema: dict[str, Any], content: list[dict[str, Any]]
    ) -> Any:
        # Plain dicts, because the content blocks are built by each feature.
        messages: Any = [{"role": "user", "content": content}]
        output_config: Any = {
            "effort": request.effort,
            "format": {"type": "json_schema", "schema": schema},
        }
        started = time.monotonic()
        try:
            message = await self._client.beta.messages.create(
                model=self.model,
                max_tokens=MAX_TOKENS,
                system=request.system,
                messages=messages,
                output_config=output_config,
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except anthropic.APIStatusError as exc:
            logger.error(
                "ai_api_error",
                extra={
                    "feature": request.feature,
                    "status": exc.status_code,
                    "request_id": exc.request_id,
                },
            )
            raise AiError("api_error") from exc
        except anthropic.APIConnectionError as exc:
            logger.error("ai_unreachable", extra={"feature": request.feature, "error": repr(exc)})
            raise AiError("unreachable") from exc
        AI_TOKENS.labels(request.feature, "input").inc(message.usage.input_tokens)
        AI_TOKENS.labels(request.feature, "output").inc(message.usage.output_tokens)
        logger.info(
            "ai_call",
            extra={
                "feature": request.feature,
                "model": message.model,
                "input_tokens": message.usage.input_tokens,
                "output_tokens": message.usage.output_tokens,
                "latency_ms": round((time.monotonic() - started) * 1000),
                "stop_reason": message.stop_reason,
                "request_id": message._request_id,
            },
        )
        return message


@lru_cache
def get_ai_client() -> AiClient:
    """The API process's client. Workers make their own: it belongs to one event loop."""
    return AiClient(get_settings())
