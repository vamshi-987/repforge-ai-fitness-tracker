from typing import Any

from pydantic import BaseModel, ConfigDict


class RevenueCatEvent(BaseModel):
    """The fields used from a webhook event. RevenueCat adds fields freely, so others are kept
    for the record but never required."""

    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    event_timestamp_ms: int
    app_user_id: str | None = None
    entitlement_ids: list[str] | None = None
    expiration_at_ms: int | None = None
    transferred_from: list[str] | None = None
    transferred_to: list[str] | None = None


class RevenueCatWebhook(BaseModel):
    model_config = ConfigDict(extra="allow")

    event: RevenueCatEvent
    api_version: Any = None
