import json
import logging
import sys

from app.core.logging import JsonFormatter, request_id_ctx


def _record(msg: str, **extra: object) -> logging.LogRecord:
    record = logging.LogRecord("app.test", logging.INFO, __file__, 1, msg, None, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_formats_json_with_extras() -> None:
    line = JsonFormatter().format(_record("request", path="/v1/health", status=200))

    payload = json.loads(line)
    assert payload["message"] == "request"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "app.test"
    assert payload["path"] == "/v1/health"
    assert payload["status"] == 200
    assert "request_id" not in payload


def test_includes_request_id_from_context() -> None:
    token = request_id_ctx.set("abc123")
    try:
        payload = json.loads(JsonFormatter().format(_record("hello")))
    finally:
        request_id_ctx.reset(token)

    assert payload["request_id"] == "abc123"


def test_includes_exception_text() -> None:
    try:
        raise ValueError("bad")
    except ValueError:
        record = logging.LogRecord(
            "app.test", logging.ERROR, __file__, 1, "failed", None, sys.exc_info()
        )

    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: bad" in payload["exc_info"]
