import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.schemas.sync import SyncChangeIn, SyncPush
from app.services.sync import is_stale

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
EARLIER = NOW - timedelta(minutes=1)
LATER = NOW + timedelta(minutes=1)


@pytest.mark.parametrize(
    ("base_version", "edited_at", "stale"),
    [
        # A device's own create, or an edit of the version the server has: no conflict.
        (None, None, False),
        (3, EARLIER, False),
        (4, EARLIER, False),
        # Edited from an older version: the later edit wins.
        (2, LATER, False),
        (2, EARLIER, True),
        (2, NOW, False),
        (2, None, True),
    ],
)
def test_last_write_wins_only_on_a_conflict(
    base_version: int | None, edited_at: datetime | None, stale: bool
) -> None:
    assert is_stale(base_version, edited_at, server_version=3, server_updated_at=NOW) is stale


def test_an_upsert_needs_data_and_a_delete_does_not() -> None:
    row = str(uuid.uuid4())
    with pytest.raises(ValidationError):
        SyncChangeIn.model_validate({"entity": "routine", "id": row, "op": "upsert"})
    change = SyncChangeIn.model_validate({"entity": "routine", "id": row, "op": "delete"})
    assert change.data is None


def test_a_push_holds_at_most_100_changes() -> None:
    change = {"entity": "workout", "id": str(uuid.uuid4()), "op": "delete"}
    assert len(SyncPush.model_validate({"changes": [change] * 100}).changes) == 100
    with pytest.raises(ValidationError):
        SyncPush.model_validate({"changes": [change] * 101})


def test_edit_times_need_a_timezone() -> None:
    with pytest.raises(ValidationError):
        SyncChangeIn.model_validate(
            {
                "entity": "workout",
                "id": str(uuid.uuid4()),
                "op": "delete",
                "updated_at": "2026-10-27T12:00:00",
            }
        )
