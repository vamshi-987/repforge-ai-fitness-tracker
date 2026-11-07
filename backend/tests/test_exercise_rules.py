import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.errors import AppError
from app.db.models import ExerciseType
from app.schemas.exercises import ExerciseCreate, ExerciseDuplicate, ExerciseOut, ExerciseUpdate
from app.services.exercise_search import ALIASES, escape_like, normalize_query
from app.services.exercises import (
    COPY_SUFFIX,
    ExerciseFilters,
    Ranked,
    _cache_get,
    _cache_set,
    bust_library_cache,
    copy_name,
    decode_cursor,
    encode_cursor,
    etag_matches,
    make_etag,
    paginate,
)

NOW = datetime(2026, 10, 26, tzinfo=UTC)


def item(name: str, *, muscle: str = "chest", equipment: str = "barbell") -> ExerciseOut:
    return ExerciseOut(
        id=uuid.uuid5(uuid.NAMESPACE_DNS, name),
        name=name,
        type=ExerciseType.WEIGHT_REPS,
        equipment=equipment,
        primary_muscle=muscle,
        secondary_muscles=[],
        instructions=[],
        media_video_url=None,
        media_thumb_url=None,
        media_license=None,
        is_custom=False,
        is_archived=False,
        version=1,
        created_at=NOW,
        updated_at=NOW,
    )


# --- query normalization ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "text", "tokens"),
    [
        ("Bench", "bench", ("bench",)),
        ("  lat   PULL  ", "lat pull", ("lat", "pull")),
        ("db bench", "dumbbell bench", ("dumbbell", "bench")),
        ("RDL", "romanian deadlift", ("romanian", "deadlift")),
        ("ez curl", "ez bar curl", ("ez", "bar", "curl")),
        ("pushups", "push-up", ("push-up",)),
        ("curl, curl/curl", "curl curl curl", ("curl",)),
    ],
)
def test_normalize_query(raw: str, text: str, tokens: tuple[str, ...]) -> None:
    query = normalize_query(raw)

    assert query is not None
    assert (query.text, query.tokens) == (text, tokens)


@pytest.mark.parametrize("raw", ["", "   ", ",;/"])
def test_blank_queries_search_nothing(raw: str) -> None:
    assert normalize_query(raw) is None


def test_queries_are_truncated() -> None:
    query = normalize_query("a" * 500)

    assert query is not None
    assert len(query.text) == 80


def test_alias_keys_are_lowercase_single_words() -> None:
    assert all(key == key.lower() and " " not in key for key in ALIASES)


def test_escape_like() -> None:
    assert escape_like(r"100%_a\b") == r"100\%\_a\\b"


# --- filters, ranking and cursors -------------------------------------------------------


def test_filters_match_primary_muscle_and_equipment() -> None:
    filters = ExerciseFilters.build(None, ["chest", "lats"], ["dumbbell"])

    assert filters.accepts(item("A", muscle="lats", equipment="dumbbell"))
    assert not filters.accepts(item("B", muscle="lats", equipment="barbell"))
    assert not filters.accepts(item("C", muscle="quads", equipment="dumbbell"))
    assert ExerciseFilters.build(None, [], []).accepts(item("D"))


def test_filter_fingerprint_ignores_order_and_spacing() -> None:
    one = ExerciseFilters.build(" Bench  ", ["lats", "chest"], [])
    two = ExerciseFilters.build("bench", ["chest", "lats"], [])

    assert one.fingerprint() == two.fingerprint()
    assert ExerciseFilters.build("   ", [], []).q is None


def test_ranking_is_best_score_then_name() -> None:
    ranked = [Ranked(item("b"), 1.0), Ranked(item("A"), 1.0), Ranked(item("c"), 2.5)]

    names = [i.name for i in paginate(ranked, None, 10)[0]]

    assert names == ["c", "A", "b"]


def test_paginate_walks_every_item_once() -> None:
    ranked = [Ranked(item(f"Exercise {i:02}"), 0.0) for i in range(7)]

    seen: list[str] = []
    cursor: str | None = None
    while True:
        page, cursor = paginate(ranked, decode_cursor(cursor) if cursor else None, 3)
        seen += [i.name for i in page]
        if cursor is None:
            break

    assert seen == [f"Exercise {i:02}" for i in range(7)]


def test_exact_page_has_no_next_cursor() -> None:
    page, cursor = paginate([Ranked(item("a"), 0.0), Ranked(item("b"), 0.0)], None, 2)

    assert len(page) == 2
    assert cursor is None


def test_cursor_round_trip() -> None:
    key = (-1.5, "bench press (barbell)", str(uuid.uuid4()))

    assert decode_cursor(encode_cursor(key)) == key


@pytest.mark.parametrize("cursor", ["%%%", "bm90LWpzb24", "WzEsMl0", "WyJhIiwiYiIsImMiXQ"])
def test_bad_cursors_are_a_422(cursor: str) -> None:
    with pytest.raises(AppError) as err:
        decode_cursor(cursor)

    assert (err.value.code, err.value.status_code) == ("invalid_cursor", 422)


# --- etags ------------------------------------------------------------------------------


def test_make_etag_is_weak_and_deterministic() -> None:
    tag = make_etag("v1", "stamp")

    assert tag.startswith('W/"') and tag.endswith('"')
    assert tag == make_etag("v1", "stamp")
    assert tag != make_etag("v2", "stamp")


@pytest.mark.parametrize(
    ("header", "matches"),
    [
        (None, False),
        ("", False),
        ('W/"abc"', True),
        ('"abc"', True),
        ('"zzz", W/"abc"', True),
        ("*", True),
        ('W/"abd"', False),
    ],
)
def test_etag_matches(header: str | None, matches: bool) -> None:
    assert etag_matches(header, 'W/"abc"') is matches


# --- names ------------------------------------------------------------------------------


def test_copy_name_fits_the_limit() -> None:
    assert copy_name("Bench Press (Barbell)") == "Bench Press (Barbell) (Copy)"
    long = copy_name("x" * 80)
    assert len(long) == 80
    assert long.endswith(COPY_SUFFIX)


# --- schemas ----------------------------------------------------------------------------


def create(**overrides: Any) -> ExerciseCreate:
    body = {"name": "My Press", "type": "weight_reps", "equipment": "barbell"}
    return ExerciseCreate.model_validate({"primary_muscle": "chest", **body, **overrides})


def test_create_normalizes_input() -> None:
    body = create(
        name="  Cable   Thing ",
        secondary_muscles=["triceps", "front_delts"],
        instructions=["  Step  one ", "", "Step two"],
    )

    assert body.name == "Cable Thing"
    assert body.secondary_muscles == ["front_delts", "triceps"]
    assert body.instructions == ["Step one", "Step two"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},
        {"name": "x" * 81},
        {"type": "cardio"},
        {"equipment": "Bar Bell"},
        {"secondary_muscles": ["triceps", "triceps"]},
        {"secondary_muscles": ["a", "b", "c", "d", "e", "f", "g"]},
        {"instructions": ["x"] * 11},
        {"media_video_url": "https://example.com/x.mp4"},
    ],
)
def test_create_rejects(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        create(**overrides)


def test_update_rejects_null_and_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        ExerciseUpdate.model_validate({"name": None})
    with pytest.raises(ValidationError):
        ExerciseUpdate.model_validate({"owner_user_id": str(uuid.uuid4())})
    assert ExerciseUpdate.model_validate({"secondary_muscles": []}).changes() == {
        "secondary_muscles": []
    }


def test_duplicate_body_is_optional_fields_only() -> None:
    assert ExerciseDuplicate().model_dump() == {"id": None, "name": None}


# --- cache fails open -------------------------------------------------------------------


class BrokenRedis:
    async def get(self, *_: object, **__: object) -> None:
        raise RedisConnectionError("down")

    async def set(self, *_: object, **__: object) -> None:
        raise RedisConnectionError("down")

    async def delete(self, *_: object, **__: object) -> None:
        raise RedisConnectionError("down")


async def test_cache_errors_are_swallowed() -> None:
    redis: Any = BrokenRedis()

    assert await _cache_get(redis, "k") is None
    await _cache_set(redis, "k", "v", 10)
    await bust_library_cache(redis)
