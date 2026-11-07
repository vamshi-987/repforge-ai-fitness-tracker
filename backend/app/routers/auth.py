from datetime import UTC, datetime

from fastapi import APIRouter, Response, status

from app.deps import DbSession, JwksFetcherDep, LoginRateLimit, RedisClient, SettingsDep
from app.schemas.auth import (
    AppleSignInRequest,
    AuthResponse,
    GoogleSignInRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
)
from app.schemas.user import UserOut
from app.services import auth as auth_service
from app.services.oauth import APPLE, GOOGLE, verify_id_token

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_response(result: auth_service.AuthResult) -> AuthResponse:
    return AuthResponse(
        **result.tokens.model_dump(),
        user=UserOut.model_validate(result.user),
        is_new_user=result.is_new_user,
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[LoginRateLimit],
)
async def register(
    body: RegisterRequest, session: DbSession, settings: SettingsDep
) -> AuthResponse:
    result = await auth_service.register(session, body, settings, datetime.now(UTC))
    return _auth_response(result)


@router.post("/login", response_model=AuthResponse, dependencies=[LoginRateLimit])
async def login(body: LoginRequest, session: DbSession, settings: SettingsDep) -> AuthResponse:
    result = await auth_service.login(
        session, body.email, body.password, settings, datetime.now(UTC)
    )
    return _auth_response(result)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, session: DbSession, settings: SettingsDep) -> TokenPair:
    return await auth_service.refresh(session, body.refresh_token, settings, datetime.now(UTC))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, session: DbSession) -> Response:
    await auth_service.logout(session, body.refresh_token, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/google", response_model=AuthResponse, dependencies=[LoginRateLimit])
async def google_sign_in(
    body: GoogleSignInRequest,
    session: DbSession,
    redis: RedisClient,
    settings: SettingsDep,
    fetch_jwks: JwksFetcherDep,
) -> AuthResponse:
    identity = await verify_id_token(
        GOOGLE, body.id_token, settings=settings, redis=redis, fetch=fetch_jwks, nonce=body.nonce
    )
    result = await auth_service.oauth_sign_in(session, identity, settings, datetime.now(UTC))
    return _auth_response(result)


@router.post("/apple", response_model=AuthResponse, dependencies=[LoginRateLimit])
async def apple_sign_in(
    body: AppleSignInRequest,
    session: DbSession,
    redis: RedisClient,
    settings: SettingsDep,
    fetch_jwks: JwksFetcherDep,
) -> AuthResponse:
    identity = await verify_id_token(
        APPLE, body.id_token, settings=settings, redis=redis, fetch=fetch_jwks, nonce=body.nonce
    )
    result = await auth_service.oauth_sign_in(
        session, identity, settings, datetime.now(UTC), display_name=body.display_name
    )
    return _auth_response(result)
