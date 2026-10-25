import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, StringConstraints

from app.db.models.user import AuthProvider

USERNAME_PATTERN = r"^[a-z0-9_][a-z0-9_.]{1,28}[a-z0-9_]$"


def _lower_strip(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


def _no_double_dots(value: str) -> str:
    if ".." in value:
        raise ValueError("username cannot contain '..'")
    return value


# 3-30 chars of a-z, 0-9, '_' and '.', not starting or ending with '.'. Case-insensitive.
Username = Annotated[
    str,
    BeforeValidator(_lower_strip),
    StringConstraints(pattern=USERNAME_PATTERN),
    AfterValidator(_no_double_dots),
]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    username: str
    display_name: str
    avatar_url: str | None
    is_private: bool
    is_pro: bool
    auth_provider: AuthProvider
    created_at: datetime
