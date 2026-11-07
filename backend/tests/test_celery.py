import uuid

import pytest

from app.services.push import Notification
from app.workers.celery_app import celery_app
from app.workers.tasks import account, photo, push, weekly
from app.workers.tasks.system import ping


def test_celery_uses_json_and_utc() -> None:
    conf = celery_app.conf

    assert conf.task_serializer == "json"
    assert conf.accept_content == ["json"]
    assert conf.enable_utc is True
    assert conf.task_acks_late is True


def test_ping_task_is_registered() -> None:
    assert "system.ping" in celery_app.tasks


def test_the_photo_task_may_outlast_its_retries() -> None:
    assert photo.analyze_photo.soft_time_limit == 270
    assert photo.analyze_photo.time_limit == 300


def test_weekly_reports_run_hourly() -> None:
    entry = celery_app.conf.beat_schedule["weekly-reports"]

    assert entry["task"] == weekly.generate_weekly_reports.name
    assert entry["schedule"].hour == set(range(24))


def test_closed_accounts_are_purged_daily() -> None:
    entry = celery_app.conf.beat_schedule["purge-accounts"]

    assert entry["task"] == account.purge_deleted.name
    assert len(entry["schedule"].hour) == 1


def test_a_dead_broker_never_reaches_the_request(monkeypatch: pytest.MonkeyPatch) -> None:
    def down(*args: object, **kwargs: object) -> None:
        raise ConnectionError("broker down")

    monkeypatch.setattr(push.send_push, "apply_async", down)

    push.enqueue_push(Notification(uuid.uuid4(), "t", "b", "/p"))


def test_a_push_is_queued_as_plain_json(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(push.send_push, "apply_async", lambda **kw: calls.append(kw))
    user_id = uuid.uuid4()

    push.enqueue_push(Notification(user_id, "t", "b", "/p"))

    assert calls == [{"args": [str(user_id), "t", "b", "/p"], "retry": False}]


def test_ping_runs_locally() -> None:
    assert ping.apply().get() == "pong"
