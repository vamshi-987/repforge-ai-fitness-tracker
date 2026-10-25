"""Shared request helpers for API integration tests."""

from typing import Any

from httpx import AsyncClient

TEST_PASSWORD = "correct-horse-battery"


async def register_user(
    client: AsyncClient, email: str = "lifter@example.com", **extra: object
) -> dict[str, Any]:
    response = await client.post(
        "/v1/auth/register", json={"email": email, "password": TEST_PASSWORD, **extra}
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def bearer(tokens: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}
