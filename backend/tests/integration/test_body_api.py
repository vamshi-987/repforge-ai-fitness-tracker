import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from httpx import AsyncClient

from app.config import Settings
from tests.integration.helpers import bearer, register_user

pytestmark = pytest.mark.integration

Headers = dict[str, str]


@pytest.fixture
async def auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client))


@pytest.fixture
async def other_auth(api_client: AsyncClient) -> Headers:
    return bearer(await register_user(api_client, email="other@example.com"))


def ago(**delta: float) -> str:
    return (datetime.now(UTC) - timedelta(**delta)).isoformat()


async def weigh(client: AsyncClient, auth: Headers, days: float, kg: float) -> dict[str, Any]:
    response = await client.post(
        "/v1/body/weights", headers=auth, json={"measured_at": ago(days=days), "weight_kg": kg}
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def presign(client: AsyncClient, auth: Headers, content_type: str = "image/jpeg") -> Any:
    response = await client.post(
        "/v1/uploads/presign",
        headers=auth,
        json={"kind": "progress_photo", "content_type": content_type},
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- weights ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/body/weights"),
        ("POST", "/v1/body/weights"),
        ("GET", "/v1/body/measurements"),
        ("GET", "/v1/body/photos"),
        ("POST", "/v1/uploads/presign"),
    ],
)
async def test_body_requires_auth(api_client: AsyncClient, method: str, path: str) -> None:
    assert (await api_client.request(method, path)).status_code == 401


async def test_weigh_ins_with_weekly_averages(api_client: AsyncClient, auth: Headers) -> None:
    # Seven daily weigh-ins always fill one Monday-to-Sunday week with at least three.
    for days in range(30, 23, -1):
        await weigh(api_client, auth, days, 80 + days / 10)
    await weigh(api_client, auth, 2, 79.0)

    body = (await api_client.get("/v1/body/weights", headers=auth)).json()

    assert [i["weight_kg"] for i in body["items"]][:2] == [79.0, 82.4]
    assert body["latest_kg"] == 79.0
    assert sum(week["weigh_ins"] for week in body["weeks"]) == 8
    averaged = [week for week in body["weeks"] if week["average_kg"] is not None]
    assert averaged and all(week["weigh_ins"] >= 3 for week in averaged)
    assert body["weeks"][-1] == {
        "week_start": body["weeks"][-1]["week_start"],
        "weigh_ins": 1,
        "average_kg": None,
    }
    # The profile shows the latest weigh-in.
    me = (await api_client.get("/v1/me", headers=auth)).json()
    assert me["profile"]["weight_kg"] == 79.0


async def test_weight_crud(api_client: AsyncClient, auth: Headers, other_auth: Headers) -> None:
    weight_id = str(uuid.uuid4())
    body = {"id": weight_id, "measured_at": ago(hours=1), "weight_kg": 80.004}
    created = await api_client.post("/v1/body/weights", headers=auth, json=body)
    again = await api_client.post("/v1/body/weights", headers=auth, json=body)
    path = f"/v1/body/weights/{weight_id}"
    edited = await api_client.patch(path, headers=auth, json={"weight_kg": 79.5})
    unchanged = await api_client.patch(path, headers=auth, json={"weight_kg": 79.5})
    theirs = await api_client.patch(path, headers=other_auth, json={"weight_kg": 50})
    future = await api_client.post(
        "/v1/body/weights", headers=auth, json={"measured_at": ago(hours=-2), "weight_kg": 80}
    )
    deleted = await api_client.delete(path, headers=auth)
    gone = await api_client.delete(path, headers=auth)

    assert created.status_code == 201
    assert created.json()["weight_kg"] == 80.0
    assert again.status_code == 409
    assert (edited.json()["weight_kg"], edited.json()["version"]) == (79.5, 2)
    assert unchanged.json()["version"] == 2
    assert theirs.status_code == 404
    assert future.status_code == 422
    assert future.json()["error"]["details"][0]["loc"] == ["body", "measured_at"]
    assert deleted.status_code == 204
    assert gone.status_code == 404


async def test_weight_ranges(api_client: AsyncClient, auth: Headers) -> None:
    await weigh(api_client, auth, 40, 85)
    await weigh(api_client, auth, 1, 80)

    month = (await api_client.get("/v1/body/weights?range=1m", headers=auth)).json()
    everything = (await api_client.get("/v1/body/weights?range=all", headers=auth)).json()

    assert [i["weight_kg"] for i in month["items"]] == [80]
    assert len(everything["items"]) == 2


# --- measurements -----------------------------------------------------------------------


async def test_measurements(api_client: AsyncClient, auth: Headers) -> None:
    waist = await api_client.post(
        "/v1/body/measurements",
        headers=auth,
        json={"measured_at": ago(days=1), "kind": "waist", "value": 82.46},
    )
    await api_client.post(
        "/v1/body/measurements",
        headers=auth,
        json={"measured_at": ago(hours=1), "kind": "body_fat", "value": 15},
    )
    path = f"/v1/body/measurements/{waist.json()['id']}"

    implausible = await api_client.patch(path, headers=auth, json={"value": 400})
    edited = await api_client.patch(path, headers=auth, json={"value": 81})
    waists = await api_client.get("/v1/body/measurements?kind=waist", headers=auth)
    everything = await api_client.get("/v1/body/measurements", headers=auth)
    await api_client.delete(path, headers=auth)
    after = await api_client.get("/v1/body/measurements", headers=auth)

    assert waist.json()["value"] == 82.5
    assert implausible.status_code == 422
    assert implausible.json()["error"]["details"][0]["loc"] == ["body", "value"]
    assert edited.json()["value"] == 81
    assert [m["kind"] for m in waists.json()] == ["waist"]
    assert [m["kind"] for m in everything.json()] == ["body_fat", "waist"]
    assert [m["kind"] for m in after.json()] == ["body_fat"]


# --- photos -----------------------------------------------------------------------------


async def test_presign_gives_a_key_under_the_user(api_client: AsyncClient, auth: Headers) -> None:
    me = (await api_client.get("/v1/me", headers=auth)).json()

    body = await presign(api_client, auth)

    assert body["object_key"].startswith(f"{me['id']}/") and body["object_key"].endswith(".jpg")
    assert "/progress-photos/" in body["upload_url"] and "X-Amz-Signature=" in body["upload_url"]
    assert (body["method"], body["headers"]) == ("PUT", {"Content-Type": "image/jpeg"})


async def test_photos_need_an_upload_of_the_user(
    api_client: AsyncClient, auth: Headers, other_auth: Headers
) -> None:
    theirs = (await presign(api_client, other_auth, "image/png"))["object_key"]

    for key in (theirs, "../etc/passwd", f"{theirs}x"):
        response = await api_client.post(
            "/v1/body/photos", headers=auth, json={"object_key": key, "taken_at": ago(hours=1)}
        )
        assert response.status_code == 422
        assert response.json()["error"]["details"][0]["loc"] == ["body", "object_key"]


async def test_photo_list_signs_urls_and_pages(api_client: AsyncClient, auth: Headers) -> None:
    keys = [(await presign(api_client, auth))["object_key"] for _ in range(3)]
    for days, key in enumerate(keys):
        response = await api_client.post(
            "/v1/body/photos",
            headers=auth,
            json={"object_key": key, "taken_at": ago(days=days), "pose": "front"},
        )
        assert response.status_code == 201, response.text
    duplicate = await api_client.post(
        "/v1/body/photos", headers=auth, json={"object_key": keys[0], "taken_at": ago(days=1)}
    )

    first = (await api_client.get("/v1/body/photos?limit=2", headers=auth)).json()
    second = (
        await api_client.get(f"/v1/body/photos?limit=2&cursor={first['next_cursor']}", headers=auth)
    ).json()
    await api_client.delete(f"/v1/body/photos/{first['items'][0]['id']}", headers=auth)
    after = (await api_client.get("/v1/body/photos", headers=auth)).json()

    assert duplicate.status_code == 409
    assert len(first["items"]) == 2 and len(second["items"]) == 1
    assert keys[0] in first["items"][0]["url"]
    assert "X-Amz-Signature=" in first["items"][0]["url"]
    assert len(after["items"]) == 2


async def test_a_photo_round_trips_through_object_storage(
    api_client: AsyncClient, auth: Headers, test_settings: Settings
) -> None:
    """Uploads to the real SeaweedFS from docker-compose; skipped where none runs (CI)."""
    async with httpx.AsyncClient(timeout=5) as storage:
        try:
            await storage.get(test_settings.s3_endpoint_url, timeout=1)
        except httpx.HTTPError:
            pytest.skip("object storage is not running")
        upload = await presign(api_client, auth)
        image = b"\xff\xd8\xff\xe0fake-jpeg-bytes"

        put = await storage.put(upload["upload_url"], content=image, headers=upload["headers"])
        photo = await api_client.post(
            "/v1/body/photos",
            headers=auth,
            json={"object_key": upload["object_key"], "taken_at": ago(minutes=1)},
        )
        url = photo.json()["url"]
        fetched = await storage.get(url)
        tampered = await storage.get(url.replace("X-Amz-Expires=3600", "X-Amz-Expires=9999"))

    assert put.status_code == 200, put.text
    assert fetched.status_code == 200 and fetched.content == image
    assert tampered.status_code == 403


# --- sync -------------------------------------------------------------------------------


async def test_weigh_ins_and_measurements_sync(api_client: AsyncClient, auth: Headers) -> None:
    weight_id, measurement_id = str(uuid.uuid4()), str(uuid.uuid4())

    def change(entity: str, row_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return {"entity": entity, "id": row_id, "op": "upsert", "data": data}

    pushed = await api_client.post(
        "/v1/sync/push",
        headers=auth,
        json={
            "changes": [
                change("body_weight", weight_id, {"measured_at": ago(hours=2), "weight_kg": 80.2}),
                change(
                    "body_measurement",
                    measurement_id,
                    {"measured_at": ago(hours=2), "kind": "waist", "value": 82},
                ),
                change(
                    "body_weight",
                    str(uuid.uuid4()),
                    {"measured_at": ago(hours=2), "weight_kg": 900},
                ),
            ]
        },
    )
    pulled = (await api_client.get("/v1/sync/pull", headers=auth)).json()
    deleted = await api_client.post(
        "/v1/sync/push",
        headers=auth,
        json={"changes": [{"entity": "body_measurement", "id": measurement_id, "op": "delete"}]},
    )

    results = pushed.json()["results"]
    assert [r["status"] for r in results] == ["applied", "applied", "rejected"]
    assert results[0]["data"]["weight_kg"] == 80.2
    entities = {(c["entity"], c["id"]) for c in pulled["changes"]}
    assert {("body_weight", weight_id), ("body_measurement", measurement_id)} <= entities
    assert deleted.json()["results"][0]["status"] == "applied"


async def test_sync_updates_and_deletes_body_rows(api_client: AsyncClient, auth: Headers) -> None:
    weight_id, measurement_id = str(uuid.uuid4()), str(uuid.uuid4())

    async def push(*changes: dict[str, Any]) -> list[dict[str, Any]]:
        response = await api_client.post(
            "/v1/sync/push", headers=auth, json={"changes": list(changes)}
        )
        results: list[dict[str, Any]] = response.json()["results"]
        return results

    def upsert(entity: str, row_id: str, data: dict[str, Any]) -> dict[str, Any]:
        return {"entity": entity, "id": row_id, "op": "upsert", "data": data}

    measured = ago(hours=3)
    await push(
        upsert("body_weight", weight_id, {"measured_at": measured, "weight_kg": 80}),
        upsert(
            "body_measurement",
            measurement_id,
            {"measured_at": measured, "kind": "hips", "value": 95},
        ),
    )
    edited = await push(
        upsert("body_weight", weight_id, {"measured_at": measured, "weight_kg": 79.6}),
        upsert(
            "body_measurement",
            measurement_id,
            {"measured_at": measured, "kind": "hips", "value": 94},
        ),
    )
    removed = await push({"entity": "body_weight", "id": weight_id, "op": "delete"})

    assert [(r["data"]["version"]) for r in edited] == [2, 2]
    assert edited[1]["data"]["value"] == 94
    assert removed[0]["status"] == "applied"
    items = (await api_client.get("/v1/body/weights", headers=auth)).json()["items"]
    assert weight_id not in {i["id"] for i in items}


async def test_rest_edits_check_times_and_ranges(api_client: AsyncClient, auth: Headers) -> None:
    weight = await weigh(api_client, auth, 1, 80)
    measurement = (
        await api_client.post(
            "/v1/body/measurements",
            headers=auth,
            json={"measured_at": ago(days=50), "kind": "neck", "value": 38},
        )
    ).json()
    future = {"measured_at": ago(hours=-3)}

    weight_future = await api_client.patch(
        f"/v1/body/weights/{weight['id']}", headers=auth, json=future
    )
    measurement_future = await api_client.patch(
        f"/v1/body/measurements/{measurement['id']}", headers=auth, json=future
    )
    moved = await api_client.patch(
        f"/v1/body/weights/{weight['id']}", headers=auth, json={"measured_at": ago(days=2)}
    )
    recent = await api_client.get("/v1/body/measurements?range=1m", headers=auth)
    photo_future = await api_client.post(
        "/v1/body/photos",
        headers=auth,
        json={
            "object_key": (await presign(api_client, auth))["object_key"],
            "taken_at": ago(hours=-3),
        },
    )

    assert weight_future.status_code == measurement_future.status_code == 422
    assert moved.json()["version"] == 2
    assert recent.json() == []
    assert photo_future.status_code == 422
