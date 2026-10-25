"""Import every model module here so Alembic autogenerate sees the full metadata."""

from app.db.base import Base
from app.db.models.auth import RefreshToken
from app.db.models.user import AuthProvider, User

__all__ = ["AuthProvider", "Base", "RefreshToken", "User"]
