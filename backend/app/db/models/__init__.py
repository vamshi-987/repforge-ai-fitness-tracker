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
from app.db.models.routine import Routine, RoutineExercise, RoutineFolder, RoutineSet, SetType
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
from app.db.models.workout import (
    PersonalRecord,
    RecordType,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutVisibility,
    workout_muscle_sets,
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
    "PersonalRecord",
    "RecordType",
    "RefreshToken",
    "Routine",
    "RoutineExercise",
    "RoutineFolder",
    "RoutineSet",
    "SetType",
    "Sex",
    "Theme",
    "User",
    "UserProfile",
    "UserSettings",
    "WeightSource",
    "WeightUnit",
    "Workout",
    "WorkoutExercise",
    "WorkoutSet",
    "WorkoutVisibility",
    "exercise_secondary_muscles",
    "workout_muscle_sets",
]
