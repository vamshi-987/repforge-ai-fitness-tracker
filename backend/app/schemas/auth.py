from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import DisplayName, Username, UserOut

# Upper bound stops multi-megabyte passwords from tying up argon2.
Password = Field(min_length=8, max_length=128)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Password
    username: Username | None = None
    display_name: DisplayName | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class GoogleSignInRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=8192)
    nonce: str | None = Field(default=None, max_length=256)


class AppleSignInRequest(BaseModel):
    id_token: str = Field(min_length=1, max_length=8192)
    nonce: str | None = Field(default=None, max_length=256)
    # Apple gives the user's name to the app only on the first sign-in, never in the token.
    display_name: DisplayName | None = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    refresh_expires_in: int


class AuthResponse(TokenPair):
    user: UserOut
    is_new_user: bool
