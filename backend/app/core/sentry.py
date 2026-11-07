from typing import Any

import sentry_sdk

from app.config import Settings

# Health data and food logs travel in request bodies, and tokens in headers: none of it is
# needed to debug a crash, so none of it leaves.
HIDDEN_HEADERS = frozenset({"authorization", "cookie", "x-api-key"})


def scrub(event: Any, _: Any) -> Any:
    request = event.get("request")
    if request:
        request.pop("data", None)
        request.pop("cookies", None)
        request.pop("query_string", None)
        headers = request.get("headers") or {}
        request["headers"] = {
            k: "[hidden]" if k.lower() in HIDDEN_HEADERS else v for k, v in headers.items()
        }
    user = event.get("user")
    if user:
        event["user"] = {k: v for k, v in user.items() if k == "id"}
    return event


def init_sentry(settings: Settings) -> None:
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.app_version,
        send_default_pii=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=scrub,
    )
