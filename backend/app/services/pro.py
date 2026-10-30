"""Pro-only features (PLAN.md G5). Until RevenueCat lands in Phase 9, `users.is_pro` is set
by hand in development."""

from typing import Annotated

from fastapi import Depends

from app.core.errors import AppError
from app.db.models import User
from app.deps import get_current_user


def pro_required(feature: str) -> AppError:
    return AppError(
        "pro_required", f"{feature} is part of RepForge Pro.", 403, {"feature": feature}
    )


def ensure_pro(user: User, feature: str) -> None:
    if not user.is_pro:
        raise pro_required(feature)


async def require_pro(user: Annotated[User, Depends(get_current_user)]) -> User:
    """Dependency for endpoints that are Pro as a whole (the AI coach in Phase 7)."""
    ensure_pro(user, "This feature")
    return user


ProUser = Annotated[User, Depends(require_pro)]
