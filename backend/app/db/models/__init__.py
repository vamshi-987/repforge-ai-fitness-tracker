"""Import every model module here so Alembic autogenerate sees the full metadata."""

from app.db.base import Base
from app.db.models.auth import RefreshToken
from app.db.models.body import BodyWeight, WeightSource
from app.db.models.exercise import (
    Equipment,
    Exercise,
    ExerciseType,
    Muscle,
    exercise_secondary_muscles,
)
from app.db.models.user import (
    ActivityLevel,
    AuthProvider,
    Experience,
    Goal,
    LengthUnit,
    Sex,
    Theme,
    User,
    UserProfile,
    UserSettings,
    WeightUnit,
)

__all__ = [
    "ActivityLevel",
    "AuthProvider",
    "Base",
    "BodyWeight",
    "Equipment",
    "Exercise",
    "ExerciseType",
    "Experience",
    "Goal",
    "LengthUnit",
    "Muscle",
    "RefreshToken",
    "Sex",
    "Theme",
    "User",
    "UserProfile",
    "UserSettings",
    "WeightSource",
    "WeightUnit",
    "exercise_secondary_muscles",
]
