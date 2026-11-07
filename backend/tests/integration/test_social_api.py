"""Follows, the feed, likes and comments, and above all who may see what."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient

from app.services.library_seed import library_id
from tests.integration.helpers import bearer, register_user

pytestmark = [pytest.mark.integration, pytest.mark.usefixtures("exercise_library")]

Headers = dict[str, str]
BENCH = str(library_id("exercise", "bench-press-barbell"))


class Person:
    def __init__(self, client: AsyncClient, headers: Headers, me: dict[str, Any]) -> None:
        self.client = client
        self.auth = headers
        self.id: str = me["id"]
        self.username: str = me["username"]

    async def post(self, path: str, **kwargs: Any) -> Any:
        return await self.client.post(f"/v1{path}", headers=self.auth, **kwargs)

    async def get(self, path: str) -> Any:
        return await self.client.get(f"/v1{path}", headers=self.auth)

    async def delete(self, path: str) -> Any:
        return await self.client.delete(f"/v1{path}", headers=self.auth)

    async def patch(self, path: str, **kwargs: Any) -> Any:
        return await self.client.patch(f"/v1{path}", headers=self.auth, **kwargs)

    async def follow(self, other: "Person") -> str:
        response = await self.post(f"/users/{other.id}/follow")
        assert response.status_code == 200, response.text
        relation: str = response.json()["relation"]
        return relation

    async def workout(
        self, visibility: str = "public", title: str = "Push", hours_ago: float = 2
    ) -> str:
        workout_id = str(uuid.uuid4())
        ended = datetime.now(UTC) - timedelta(hours=hours_ago)
        response = await self.client.put(
            f"/v1/workouts/{workout_id}",
            headers=self.auth,
            json={
                "title": title,
                "visibility": visibility,
                "started_at": (ended - timedelta(hours=1)).isoformat(),
                "ended_at": ended.isoformat(),
                "exercises": [
                    {
                        "exercise_id": BENCH,
                        "sets": [
                            {"set_type": "warmup", "weight_kg": 20, "reps": 10},
                            {"weight_kg": 60, "reps": 8},
                            {"weight_kg": 60, "reps": 8},
                        ],
                    }
                ],
            },
        )
        assert response.status_code in (200, 201), response.text
        return workout_id

    async def feed_titles(self) -> list[str]:
        return [w["title"] for w in (await self.get("/feed")).json()["items"]]


async def person(client: AsyncClient, name: str, private: bool = False) -> Person:
    headers = bearer(await register_user(client, f"{name}@example.com"))
    response = await client.patch(
        "/v1/me",
        headers=headers,
        json={"username": name, "display_name": name.title(), "is_private": private},
    )
    assert response.status_code == 200, response.text
    return Person(client, headers, response.json())


@pytest.fixture
async def ana(api_client: AsyncClient) -> Person:
    return await person(api_client, "ana")


@pytest.fixture
async def ben(api_client: AsyncClient) -> Person:
    return await person(api_client, "ben")


@pytest.fixture
async def kim(api_client: AsyncClient) -> Person:
    return await person(api_client, "kim", private=True)


# --- the feed and visibility ------------------------------------------------------------


async def test_following_someone_puts_their_workouts_in_the_feed(ana: Person, ben: Person) -> None:
    workout_id = await ana.workout()
    assert await ben.feed_titles() == []

    assert await ben.follow(ana) == "following"

    (item,) = (await ben.get("/feed")).json()["items"]
    assert item["id"] == workout_id
    assert item["user"] == {
        "id": ana.id,
        "username": "ana",
        "display_name": "Ana",
        "avatar_url": None,
    }
    # The warm-up isn't a logged set here.
    assert item["exercises"] == [{"name": "Bench Press (Barbell)", "sets": 2}]
    assert (item["like_count"], item["comment_count"], item["liked"]) == (0, 0, False)


async def test_the_feed_never_leaks_an_email(ana: Person, ben: Person) -> None:
    await ana.workout()
    await ben.follow(ana)

    assert "@example.com" not in (await ben.get("/feed")).text
    assert "@example.com" not in (await ben.get("/users/ana")).text
    assert "@example.com" not in (await ben.get("/users/search?q=ana")).text


async def test_the_feed_has_your_own_shared_workouts_newest_first(ana: Person, ben: Person) -> None:
    await ben.follow(ana)
    await ana.workout(title="Older", hours_ago=30)
    await ben.workout(title="Mine", hours_ago=10)
    await ana.workout(title="Newest", hours_ago=2)
    await ben.workout("private", title="Secret", hours_ago=1)

    assert await ben.feed_titles() == ["Newest", "Mine", "Older"]


@pytest.mark.parametrize(
    ("visibility", "in_feed"), [("public", True), ("followers", True), ("private", False)]
)
async def test_what_a_follower_sees(
    ana: Person, ben: Person, visibility: str, in_feed: bool
) -> None:
    workout_id = await ana.workout(visibility)
    await ben.follow(ana)

    assert bool(await ben.feed_titles()) is in_feed
    status = (await ben.get(f"/feed/workouts/{workout_id}")).status_code
    assert status == (200 if in_feed else 404)


@pytest.mark.parametrize(("visibility", "status"), [("public", 200), ("followers", 404)])
async def test_what_a_stranger_sees(ana: Person, ben: Person, visibility: str, status: int) -> None:
    workout_id = await ana.workout(visibility)

    assert (await ben.get(f"/feed/workouts/{workout_id}")).status_code == status
    assert await ben.feed_titles() == []


async def test_a_private_profile_hides_even_public_workouts(kim: Person, ben: Person) -> None:
    workout_id = await kim.workout("public")

    assert (await ben.get(f"/feed/workouts/{workout_id}")).status_code == 404
    assert (await ben.get("/users/kim/workouts")).status_code == 403
    assert (await ben.post(f"/workouts/{workout_id}/like")).status_code == 404
    assert (await ben.get(f"/workouts/{workout_id}/comments")).status_code == 404


async def test_a_private_profile_approves_followers(kim: Person, ben: Person) -> None:
    workout_id = await kim.workout("followers")

    assert await ben.follow(kim) == "requested"
    assert await ben.feed_titles() == []
    assert (await ben.get("/users/kim")).json()["relation"] == "requested"
    assert (await ben.get("/users/kim")).json()["followers"] == 0

    (request,) = (await kim.get("/follow-requests")).json()["items"]
    assert request["user"]["username"] == "ben"
    assert (await kim.post(f"/follow-requests/{ben.id}/accept")).status_code == 204

    assert await ben.feed_titles() == ["Push"]
    assert (await ben.get(f"/feed/workouts/{workout_id}")).status_code == 200
    assert (await kim.get("/follow-requests")).json()["items"] == []
    profile = (await ben.get("/users/kim")).json()
    assert (profile["relation"], profile["followers"]) == ("following", 1)
    assert profile["can_view_workouts"] is True


async def test_declining_a_request(kim: Person, ben: Person) -> None:
    await ben.follow(kim)

    assert (await kim.delete(f"/followers/{ben.id}")).status_code == 204

    assert (await ben.get("/users/kim")).json()["relation"] == "none"
    assert (await kim.post(f"/follow-requests/{ben.id}/accept")).status_code == 404


async def test_removing_a_follower_cuts_their_access(kim: Person, ben: Person) -> None:
    await kim.workout("followers")
    await ben.follow(kim)
    await kim.post(f"/follow-requests/{ben.id}/accept")

    await kim.delete(f"/followers/{ben.id}")

    assert await ben.feed_titles() == []


async def test_going_public_lets_waiting_requests_through(kim: Person, ben: Person) -> None:
    await ben.follow(kim)

    await kim.patch("/me", json={"is_private": False})

    assert (await ben.get("/users/kim")).json()["relation"] == "following"


async def test_going_private_keeps_followers_and_stops_strangers(
    ana: Person, ben: Person, api_client: AsyncClient
) -> None:
    workout_id = await ana.workout()
    await ben.follow(ana)
    stranger = await person(api_client, "sam")

    await ana.patch("/me", json={"is_private": True})

    assert (await ben.get(f"/feed/workouts/{workout_id}")).status_code == 200
    assert (await stranger.get(f"/feed/workouts/{workout_id}")).status_code == 404


async def test_a_deleted_workout_leaves_the_feed(ana: Person, ben: Person) -> None:
    workout_id = await ana.workout()
    await ben.follow(ana)

    await ana.delete(f"/workouts/{workout_id}")

    assert await ben.feed_titles() == []
    assert (await ben.get(f"/feed/workouts/{workout_id}")).status_code == 404


async def test_the_feed_pages_without_repeats(ana: Person, ben: Person) -> None:
    await ben.follow(ana)
    for hours in (1, 2, 3):
        await ana.workout(title=f"W{hours}", hours_ago=hours)

    first = (await ben.get("/feed?limit=2")).json()
    second = (await ben.get(f"/feed?limit=2&cursor={first['next_cursor']}")).json()

    assert [w["title"] for w in first["items"]] == ["W1", "W2"]
    assert [w["title"] for w in second["items"]] == ["W3"]
    assert second["next_cursor"] is None


async def test_a_bad_cursor_is_refused(ben: Person) -> None:
    assert (await ben.get("/feed?cursor=nonsense")).status_code == 422


async def test_a_profile_lists_what_the_viewer_may_see(ana: Person, ben: Person) -> None:
    await ana.workout("public", title="Open")
    await ana.workout("followers", title="Friends")
    await ana.workout("private", title="Secret")

    async def titles(viewer: Person) -> set[str]:
        response = await viewer.get("/users/ana/workouts")
        assert response.status_code == 200
        return {w["title"] for w in response.json()["items"]}

    assert await titles(ben) == {"Open"}
    await ben.follow(ana)
    assert await titles(ben) == {"Open", "Friends"}
    assert await titles(ana) == {"Open", "Friends", "Secret"}


# --- people -----------------------------------------------------------------------------


async def test_profiles_count_followers_and_following(ana: Person, ben: Person) -> None:
    await ben.follow(ana)

    theirs = (await ben.get("/users/ana")).json()
    mine = (await ben.get("/users/ben")).json()

    assert (theirs["followers"], theirs["following"], theirs["relation"]) == (1, 0, "following")
    assert (mine["followers"], mine["following"], mine["relation"]) == (0, 1, "self")


async def test_usernames_ignore_case(ana: Person, ben: Person) -> None:
    assert (await ben.get("/users/ANA")).json()["id"] == ana.id


async def test_unknown_people_are_404s(ben: Person) -> None:
    assert (await ben.get("/users/nobody")).status_code == 404
    assert (await ben.get("/users/nobody/workouts")).status_code == 404
    assert (await ben.post(f"/users/{uuid.uuid4()}/follow")).status_code == 404


async def test_following_is_idempotent_and_never_yourself(ana: Person, ben: Person) -> None:
    assert await ben.follow(ana) == "following"
    assert await ben.follow(ana) == "following"
    assert (await ana.get("/users/ana")).json()["followers"] == 1

    assert (await ben.post(f"/users/{ben.id}/follow")).status_code == 422


async def test_unfollowing(ana: Person, ben: Person) -> None:
    await ana.workout()
    await ben.follow(ana)

    assert (await ben.delete(f"/users/{ana.id}/follow")).status_code == 204

    assert await ben.feed_titles() == []
    assert (await ben.delete(f"/users/{ana.id}/follow")).status_code == 204


async def test_search_finds_usernames_first_and_shows_relations(
    api_client: AsyncClient, ana: Person, ben: Person
) -> None:
    await person(api_client, "banana")
    await ben.follow(ana)

    items = (await ben.get("/users/search?q=@ana")).json()["items"]

    assert [(u["username"], u["relation"]) for u in items] == [
        ("ana", "following"),
        ("banana", "none"),
    ]


async def test_search_leaves_out_yourself_and_ignores_short_queries(ben: Person) -> None:
    assert (await ben.get("/users/search?q=ben")).json()["items"] == []
    assert (await ben.get("/users/search?q=b")).json()["items"] == []


async def test_search_treats_wildcards_as_text(ana: Person, ben: Person) -> None:
    assert (await ben.get("/users/search?q=%25%25")).json()["items"] == []


# --- likes ------------------------------------------------------------------------------


async def test_liking_and_unliking(ana: Person, ben: Person) -> None:
    workout_id = await ana.workout()
    await ben.follow(ana)

    assert (await ben.post(f"/workouts/{workout_id}/like")).json() == {
        "liked": True,
        "like_count": 1,
    }
    assert (await ben.post(f"/workouts/{workout_id}/like")).json()["like_count"] == 1
    (item,) = (await ben.get("/feed")).json()["items"]
    assert (item["liked"], item["like_count"]) == (True, 1)
    (owner_view,) = (await ana.get("/feed")).json()["items"]
    assert (owner_view["liked"], owner_view["like_count"]) == (False, 1)

    assert (await ben.delete(f"/workouts/{workout_id}/like")).json() == {
        "liked": False,
        "like_count": 0,
    }


# --- comments ---------------------------------------------------------------------------


async def test_commenting(ana: Person, ben: Person) -> None:
    workout_id = await ana.workout()

    response = await ben.post(f"/workouts/{workout_id}/comments", json={"body": "  Nice   set! "})

    assert response.status_code == 201, response.text
    assert response.json()["body"] == "Nice set!"
    assert response.json()["user"]["username"] == "ben"
    assert response.json()["can_delete"] is True
    (listed,) = (await ana.get(f"/workouts/{workout_id}/comments")).json()["items"]
    assert listed["can_delete"] is True
    assert (await ana.get(f"/feed/workouts/{workout_id}")).json()["comment_count"] == 1


@pytest.mark.parametrize("body", ["", "   ", "x" * 501])
async def test_comments_must_be_sensible(ana: Person, ben: Person, body: str) -> None:
    workout_id = await ana.workout()

    response = await ben.post(f"/workouts/{workout_id}/comments", json={"body": body})

    assert response.status_code == 422


async def test_comments_page_oldest_first(ana: Person, ben: Person) -> None:
    workout_id = await ana.workout()
    for text in ("one", "two", "three"):
        await ben.post(f"/workouts/{workout_id}/comments", json={"body": text})

    first = (await ana.get(f"/workouts/{workout_id}/comments?limit=2")).json()
    cursor = first["next_cursor"]
    second = (await ana.get(f"/workouts/{workout_id}/comments?limit=2&cursor={cursor}")).json()

    assert len(first["items"]) == 2
    assert len(second["items"]) == 1
    assert len({c["id"] for c in [*first["items"], *second["items"]]}) == 3
    assert second["next_cursor"] is None


async def test_only_the_author_edits_a_comment(ana: Person, ben: Person) -> None:
    workout_id = await ana.workout()
    comment = (await ben.post(f"/workouts/{workout_id}/comments", json={"body": "Nice"})).json()
    path = f"/workouts/{workout_id}/comments/{comment['id']}"

    edited = await ben.patch(path, json={"body": "Very nice"})
    denied = await ana.patch(path, json={"body": "Mine now"})

    assert edited.json()["body"] == "Very nice"
    assert denied.status_code == 403


async def test_the_author_and_the_owner_may_delete_a_comment(
    api_client: AsyncClient, ana: Person, ben: Person
) -> None:
    workout_id = await ana.workout()
    stranger = await person(api_client, "sam")
    add = f"/workouts/{workout_id}/comments"
    first = (await ben.post(add, json={"body": "One"})).json()["id"]
    second = (await ben.post(add, json={"body": "Two"})).json()["id"]

    assert (await stranger.delete(f"{add}/{first}")).status_code == 403
    assert (await ben.delete(f"{add}/{first}")).status_code == 204
    assert (await ana.delete(f"{add}/{second}")).status_code == 204
    assert (await ana.get(add)).json()["items"] == []


async def test_a_comment_belongs_to_its_workout(ana: Person, ben: Person) -> None:
    first = await ana.workout(title="A")
    second = await ana.workout(title="B")
    comment = (await ben.post(f"/workouts/{first}/comments", json={"body": "Hi"})).json()

    response = await ben.delete(f"/workouts/{second}/comments/{comment['id']}")

    assert response.status_code == 404
    missing = await ben.delete(f"/workouts/{first}/comments/{uuid.uuid4()}")
    assert missing.status_code == 404
