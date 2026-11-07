import uuid
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

from app.config import Settings
from app.services.storage import new_upload, presign, signed_url, user_prefix

NOW = datetime(2026, 10, 30, 9, 0, tzinfo=UTC)


def test_matches_the_aws_signature_v4_example() -> None:
    """The query-string signing example from the AWS S3 docs (Signature Version 4)."""
    url = presign(
        "GET",
        "https://examplebucket.s3.amazonaws.com/test.txt",
        access_key="AKIAIOSFODNN7EXAMPLE",
        secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region="us-east-1",
        now=datetime(2013, 5, 24, tzinfo=UTC),
        expires_s=86400,
    )

    assert url == (
        "https://examplebucket.s3.amazonaws.com/test.txt"
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256"
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request"
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host"
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    )


def test_signed_urls_use_the_public_address() -> None:
    settings = Settings(s3_public_url="http://192.168.1.20:9010/", s3_endpoint_url="http://s3:8333")

    url = signed_url(settings, "GET", "progress-photos", "u/a b.jpg", NOW, 60)

    parts = urlsplit(url)
    assert (parts.netloc, parts.path) == ("192.168.1.20:9010", "/progress-photos/u/a%20b.jpg")
    assert parse_qs(parts.query)["X-Amz-Expires"] == ["60"]


def test_uploads_live_under_the_users_prefix() -> None:
    user = uuid.uuid4()
    settings = Settings(s3_public_url=None, s3_endpoint_url="http://localhost:9010")

    upload = new_upload(settings, user, "image/png", NOW)

    assert upload.object_key.startswith(user_prefix(user))
    assert upload.object_key.endswith(".png")
    assert upload.upload_url.startswith(
        f"http://localhost:9010/progress-photos/{upload.object_key}?"
    )
    assert (upload.expires_at - NOW).total_seconds() == settings.upload_url_ttl_s
