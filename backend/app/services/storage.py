"""Signed URLs for object storage (S3 API), so photos go straight from the phone to the
bucket and back without passing through the API.

Signing is AWS Signature Version 4 in query-string form, written out here (≈40 lines)
instead of pulling in boto3. The test pins it to AWS's published example. URLs are
path-style (`/bucket/key`), which SeaweedFS, R2 and S3 all accept.
"""

import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import quote, urlsplit

import httpx

from app.config import Settings

ALGORITHM = "AWS4-HMAC-SHA256"
SERVICE = "s3"
STORAGE_TIMEOUT_S = 20.0


def _quote(value: str, safe: str = "-_.~") -> str:
    return quote(value, safe=safe)


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


def presign(
    method: str,
    url: str,
    *,
    access_key: str,
    secret_key: str,
    region: str,
    now: datetime,
    expires_s: int,
) -> str:
    """A query-signed URL for `method` on `url` (scheme://host/path), valid for `expires_s`.
    Only the host is signed, so the client may send any headers (Content-Type)."""
    parts = urlsplit(url)
    path = _quote(parts.path, safe="/-_.~")
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    scope = f"{now.strftime('%Y%m%d')}/{region}/{SERVICE}/aws4_request"
    params = {
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": f"{access_key}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires_s),
        "X-Amz-SignedHeaders": "host",
    }
    query = "&".join(f"{_quote(k)}={_quote(v)}" for k, v in sorted(params.items()))
    canonical = "\n".join(
        [method, path, query, f"host:{parts.netloc}\n", "host", "UNSIGNED-PAYLOAD"]
    )
    to_sign = "\n".join(
        [ALGORITHM, amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
    )
    key = _hmac(f"AWS4{secret_key}".encode(), now.strftime("%Y%m%d"))
    for part in (region, SERVICE, "aws4_request"):
        key = _hmac(key, part)
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{parts.scheme}://{parts.netloc}{path}?{query}&X-Amz-Signature={signature}"


def object_url(settings: Settings, bucket: str, key: str) -> str:
    base = (settings.s3_public_url or settings.s3_endpoint_url).rstrip("/")
    return f"{base}/{bucket}/{key}"


def signed_url(
    settings: Settings, method: str, bucket: str, key: str, now: datetime, expires_s: int
) -> str:
    return presign(
        method,
        object_url(settings, bucket, key),
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key,
        region=settings.s3_region,
        now=now,
        expires_s=expires_s,
    )


# --- uploads --------------------------------------------------------------------------

# What may be uploaded: kind → (bucket setting, allowed content types → file extension).
CONTENT_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/heic": "heic"}


@dataclass(frozen=True)
class Upload:
    object_key: str
    upload_url: str
    expires_at: datetime


def user_prefix(user_id: uuid.UUID) -> str:
    """Every object a user uploads lives under their id, so a key proves its owner."""
    return f"{user_id}/"


def new_upload(settings: Settings, user_id: uuid.UUID, content_type: str, now: datetime) -> Upload:
    key = f"{user_prefix(user_id)}{uuid.uuid4()}.{CONTENT_TYPES[content_type]}"
    ttl = settings.upload_url_ttl_s
    return Upload(
        object_key=key,
        upload_url=signed_url(settings, "PUT", settings.s3_bucket_progress_photos, key, now, ttl),
        expires_at=now + timedelta(seconds=ttl),
    )


# --- the API's own objects ------------------------------------------------------------


class StorageError(Exception):
    """Object storage refused or couldn't be reached."""


class PhotoStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes: ...


class ObjectRemover(Protocol):
    async def remove(self, bucket: str, key: str) -> None: ...


class S3PhotoStore:
    """Food photos, read and written by the API and workers themselves (not by phones), so
    URLs are signed for the internal address."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _url(self, method: str, bucket: str, key: str) -> str:
        settings = self.settings
        base = settings.s3_endpoint_url.rstrip("/")
        return presign(
            method,
            f"{base}/{bucket}/{key}",
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            region=settings.s3_region,
            now=datetime.now(UTC),
            expires_s=60,
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        url = self._url("PUT", self.settings.s3_bucket_food_photos, key)
        await self._call("PUT", url, content=data, headers={"Content-Type": content_type})

    async def get(self, key: str) -> bytes:
        url = self._url("GET", self.settings.s3_bucket_food_photos, key)
        return (await self._call("GET", url)).content

    async def remove(self, bucket: str, key: str) -> None:
        await self._call("DELETE", self._url("DELETE", bucket, key))

    async def _call(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=STORAGE_TIMEOUT_S) as client:
                response = await client.request(method, url, **kwargs)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise StorageError(repr(exc)) from exc
        return response
