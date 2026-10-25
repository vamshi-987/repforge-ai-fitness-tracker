"""Accounts and sessions: register, login, Google/Apple sign-in, refresh rotation, logout.

Refresh tokens rotate on every use. Each login starts a token *family*; refreshing revokes
the presented token and issues its successor in the same family. If a revoked token is
presented again, someone holds a copy (it was stolen, or replayed), so the whole family is
revoked and both the thief and the user must sign in again.
"""

import logging
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.errors import AppError, AuthError, ConflictError
from app.db.models import AuthProvider, RefreshToken, User, UserProfile, UserSettings
from app.schemas.auth import RegisterRequest, TokenPair
from app.services.oauth import OAuthIdentity
from app.services.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    hasher_for,
    new_refresh_token,
    verify_password,
)

logger = logging.getLogger(__name__)

RefreshState = Literal["ok", "reused", "expired"]


@dataclass(frozen=True)
class AuthResult:
    user: User
    tokens: TokenPair
    is_new_user: bool


# --- pure helpers -----------------------------------------------------------------------


def normalize_email(email: str) -> str:
    return email.strip().lower()


def username_base(email: str) -> str:
    """A valid username derived from the email's local part (uniqueness is checked later)."""
    cleaned = re.sub(r"[^a-z0-9_]", "", email.split("@", 1)[0].lower())[:20]
    return cleaned if len(cleaned) >= 3 else f"{cleaned}lifter"


def classify_refresh(
    revoked_at: datetime | None, expires_at: datetime, now: datetime
) -> RefreshState:
    if revoked_at is not None:
        return "reused"
    if expires_at <= now:
        return "expired"
    return "ok"


def conflict_from(exc: IntegrityError) -> AppError:
    message = str(exc.orig)
    if "uq_users_email" in message:
        return ConflictError("email_taken", "An account with this email already exists")
    if "uq_users_username" in message:
        return ConflictError("username_taken", "That username is taken")
    return ConflictError("conflict", "Account already exists")


# --- users ------------------------------------------------------------------------------


async def username_available(session: AsyncSession, username: str) -> bool:
    return await session.scalar(select(User.id).where(User.username == username)) is None


async def _pick_username(session: AsyncSession, email: str) -> str:
    base = username_base(email)
    if await username_available(session, base):
        return base
    for _ in range(5):
        candidate = f"{base}{secrets.randbelow(10_000):04d}"
        if await username_available(session, candidate):
            return candidate
    return f"{base}{uuid.uuid4().hex[:8]}"


async def create_user(
    session: AsyncSession,
    *,
    email: str,
    provider: AuthProvider,
    password_hash: str | None = None,
    username: str | None = None,
    display_name: str | None = None,
    google_sub: str | None = None,
    apple_sub: str | None = None,
) -> User:
    """Insert a user with default profile and settings rows.

    A unique-constraint race surfaces as a 409, never a 500.
    """
    username = username or await _pick_username(session, email)
    user = User(
        email=email,
        password_hash=password_hash,
        auth_provider=provider,
        username=username,
        # Provider-supplied names are unvalidated, so clamp to the column size.
        display_name=(display_name or username)[:60],
        google_sub=google_sub,
        apple_sub=apple_sub,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise conflict_from(exc) from exc
    # Every account has exactly one profile and one settings row, created with defaults.
    session.add_all([UserProfile(user_id=user.id), UserSettings(user_id=user.id)])
    await session.flush()
    return user


# --- tokens -----------------------------------------------------------------------------


async def _issue_tokens(
    session: AsyncSession,
    user: User,
    settings: Settings,
    now: datetime,
    family_id: uuid.UUID | None = None,
) -> tuple[TokenPair, RefreshToken]:
    raw, digest = new_refresh_token()
    row = RefreshToken(
        user_id=user.id,
        token_hash=digest,
        family_id=family_id or uuid.uuid4(),
        expires_at=now + timedelta(seconds=settings.refresh_token_ttl_s),
    )
    session.add(row)
    await session.flush()
    tokens = TokenPair(
        access_token=create_access_token(user.id, settings, now),
        refresh_token=raw,
        expires_in=settings.access_token_ttl_s,
        refresh_expires_in=settings.refresh_token_ttl_s,
    )
    return tokens, row


async def _revoke_family(session: AsyncSession, family_id: uuid.UUID, now: datetime) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


# --- flows ------------------------------------------------------------------------------


async def register(
    session: AsyncSession, request: RegisterRequest, settings: Settings, now: datetime
) -> AuthResult:
    email = normalize_email(request.email)
    if await session.scalar(select(User.id).where(User.email == email)) is not None:
        raise ConflictError("email_taken", "An account with this email already exists")
    if request.username and not await username_available(session, request.username):
        raise ConflictError("username_taken", "That username is taken")

    user = await create_user(
        session,
        email=email,
        provider=AuthProvider.PASSWORD,
        password_hash=await hash_password(request.password, hasher_for(settings)),
        username=request.username,
        display_name=request.display_name,
    )
    tokens, _ = await _issue_tokens(session, user, settings, now)
    await session.commit()
    return AuthResult(user=user, tokens=tokens, is_new_user=True)


async def login(
    session: AsyncSession, email: str, password: str, settings: Settings, now: datetime
) -> AuthResult:
    user = await session.scalar(
        select(User).where(User.email == normalize_email(email), User.deleted_at.is_(None))
    )
    hasher = hasher_for(settings)
    matches, needs_rehash = await verify_password(
        password, user.password_hash if user else None, hasher
    )
    # Same error for "no such email", "wrong password" and "social-only account".
    if user is None or not matches:
        raise AuthError("invalid_credentials", "Email or password is incorrect")
    if needs_rehash:
        user.password_hash = await hash_password(password, hasher)

    tokens, _ = await _issue_tokens(session, user, settings, now)
    await session.commit()
    return AuthResult(user=user, tokens=tokens, is_new_user=False)


async def oauth_sign_in(
    session: AsyncSession,
    identity: OAuthIdentity,
    settings: Settings,
    now: datetime,
    display_name: str | None = None,
) -> AuthResult:
    """Sign in by provider subject; else link to the account with the same verified email;
    else create a new account."""
    sub_column = User.google_sub if identity.provider == "google" else User.apple_sub
    user = await session.scalar(select(User).where(sub_column == identity.subject))
    is_new_user = False

    if user is None:
        if identity.email is None or not identity.email_verified:
            raise AppError(
                "email_required", "Sign-in needs a verified email address from the provider", 422
            )
        user = await session.scalar(select(User).where(User.email == identity.email))
        if user is None:
            is_google = identity.provider == "google"
            user = await create_user(
                session,
                email=identity.email,
                provider=AuthProvider(identity.provider),
                display_name=display_name or identity.name,
                google_sub=identity.subject if is_google else None,
                apple_sub=None if is_google else identity.subject,
            )
            is_new_user = True
        elif identity.provider == "google":
            user.google_sub = identity.subject
        else:
            user.apple_sub = identity.subject

    if user.deleted_at is not None:
        raise AuthError("account_deleted", "This account has been deleted")

    tokens, _ = await _issue_tokens(session, user, settings, now)
    await session.commit()
    return AuthResult(user=user, tokens=tokens, is_new_user=is_new_user)


async def refresh(
    session: AsyncSession, raw_token: str, settings: Settings, now: datetime
) -> TokenPair:
    # FOR UPDATE serializes two refreshes of the same token: the second one sees it revoked.
    row = await session.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(raw_token))
        .with_for_update()
    )
    if row is None:
        raise AuthError("invalid_refresh_token", "Refresh token is invalid")

    state = classify_refresh(row.revoked_at, row.expires_at, now)
    if state == "reused":
        await _revoke_family(session, row.family_id, now)
        await session.commit()
        logger.warning(
            "refresh_token_reuse",
            extra={"user_id": str(row.user_id), "family_id": str(row.family_id)},
        )
        raise AuthError("refresh_token_reused", "This session was revoked, sign in again")
    if state == "expired":
        raise AuthError("refresh_token_expired", "Session expired, sign in again")

    user = await session.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        raise AuthError("invalid_refresh_token", "Refresh token is invalid")

    tokens, successor = await _issue_tokens(session, user, settings, now, family_id=row.family_id)
    row.revoked_at = now
    row.replaced_by = successor.id
    await session.commit()
    return tokens


async def logout(session: AsyncSession, raw_token: str, now: datetime) -> None:
    """Revoke the token's whole family (this device's session). Unknown tokens are a no-op."""
    family_id = await session.scalar(
        select(RefreshToken.family_id).where(
            RefreshToken.token_hash == hash_refresh_token(raw_token)
        )
    )
    if family_id is not None:
        await _revoke_family(session, family_id, now)
        await session.commit()
