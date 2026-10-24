from typing import Any

from celery import Celery

from app.config import get_settings
from app.core.logging import configure_logging

# Periodic jobs are registered here as their features land (weekly reports, cache refresh, ...).
BEAT_SCHEDULE: dict[str, dict[str, Any]] = {}


def create_celery() -> Celery:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = Celery(
        "repforge",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
        include=["app.workers.tasks.system"],
    )
    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        # Re-deliver a task if the worker dies mid-run; tasks must be idempotent.
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
        task_soft_time_limit=90,
        task_time_limit=120,
        result_expires=3600,
        broker_connection_retry_on_startup=True,
        worker_hijack_root_logger=False,
        beat_schedule=BEAT_SCHEDULE,
    )
    return app


celery_app = create_celery()
