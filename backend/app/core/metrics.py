"""Prometheus metrics for the API process. Labels use the route template, never the raw path:
ids in paths would make a new series per user."""

import time

from prometheus_client import Counter, Histogram
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUESTS = Counter("repforge_http_requests_total", "HTTP requests", ["method", "route", "status"])
LATENCY = Histogram(
    "repforge_http_request_duration_seconds", "HTTP request latency", ["method", "route"]
)
AI_TOKENS = Counter("repforge_ai_tokens_total", "LLM tokens used", ["feature", "kind"])

UNMATCHED = "unmatched"
SKIPPED_PATHS = frozenset({"/metrics"})


def route_label(scope: Scope) -> str:
    """The path with its parameters named. Built from the path, because a route only knows the
    part after its router's prefix."""
    if "route" not in scope:
        return UNMATCHED
    names = {str(value): name for name, value in scope.get("path_params", {}).items()}
    segments = scope["path"].split("/")
    return "/".join(f"{{{names[s]}}}" if s in names else s for s in segments)


class MetricsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in SKIPPED_PATHS:
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            route = route_label(scope)
            method = scope["method"]
            REQUESTS.labels(method, route, str(status_code)).inc()
            LATENCY.labels(method, route).observe(time.perf_counter() - started)
