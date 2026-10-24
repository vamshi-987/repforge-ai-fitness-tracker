from app.workers.celery_app import celery_app
from app.workers.tasks.system import ping


def test_celery_uses_json_and_utc() -> None:
    conf = celery_app.conf

    assert conf.task_serializer == "json"
    assert conf.accept_content == ["json"]
    assert conf.enable_utc is True
    assert conf.task_acks_late is True


def test_ping_task_is_registered() -> None:
    assert "system.ping" in celery_app.tasks


def test_ping_runs_locally() -> None:
    assert ping.apply().get() == "pong"
