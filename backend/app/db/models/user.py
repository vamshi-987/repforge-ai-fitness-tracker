import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin


class AuthProvider(StrEnum):
    PASSWORD = "password"
    GOOGLE = "google"
    APPLE = "apple"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Stored lowercased (services.auth.normalize_email), so a plain unique index is enough.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    # NULL for accounts created through Google/Apple only.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # How the account was first created; linked providers are the *_sub columns.
    auth_provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider, name="auth_provider", values_callable=lambda e: [m.value for m in e])
    )
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    apple_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    username: Mapped[str] = mapped_column(String(30), unique=True)
    display_name: Mapped[str] = mapped_column(String(60))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    is_private: Mapped[bool] = mapped_column(default=False, server_default=false())
    is_pro: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Set by account deletion (Phase 9); a hard delete follows within 30 days.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
