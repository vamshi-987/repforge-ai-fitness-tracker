"""Import every model module here so Alembic autogenerate sees the full metadata."""

# Registers the sync lock hook on every session (see app/db/change_lock.py).
import app.db.change_lock  # noqa: F401
from app.db.base import Base
from app.db.models.auth import RefreshToken
from app.db.models.billing import SubscriptionEvent
from app.db.models.body import (
    BodyMeasurement,
    BodyWeight,
    MeasurementKind,
    PhotoPose,
    ProgressPhoto,
    WeightSource,
)
from app.db.models.coach import OverloadRule, OverloadSuggestion, WeeklyReport
from app.db.models.exercise import (
    Equipment,
    Exercise,
    ExerciseType,
    Muscle,
    exercise_secondary_muscles,
)
from app.db.models.nutrition import (
    AnalysisStatus,
    Food,
    FoodLog,
    FoodServing,
    FoodSource,
    LogSource,
    Meal,
    NutritionTarget,
    PhotoAnalysis,
    SavedMeal,
    SavedMealItem,
    TargetReason,
)
from app.db.models.routine import Routine, RoutineExercise, RoutineFolder, RoutineSet, SetType
from app.db.models.social import Follow, FollowStatus, PushToken, WorkoutComment, WorkoutLike
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
from app.db.models.water import WaterLog
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
    "AnalysisStatus",
    "AuthProvider",
    "Base",
    "BodyMeasurement",
    "BodyWeight",
    "Equipment",
    "Exercise",
    "ExerciseType",
    "Experience",
    "Follow",
    "FollowStatus",
    "Food",
    "FoodLog",
    "FoodServing",
    "FoodSource",
    "Goal",
    "LengthUnit",
    "LogSource",
    "Meal",
    "MeasurementKind",
    "Muscle",
    "NutritionTarget",
    "OverloadRule",
    "OverloadSuggestion",
    "PersonalRecord",
    "PhotoAnalysis",
    "PhotoPose",
    "ProgressPhoto",
    "PushToken",
    "RecordType",
    "RefreshToken",
    "Routine",
    "RoutineExercise",
    "RoutineFolder",
    "RoutineSet",
    "SavedMeal",
    "SavedMealItem",
    "SetType",
    "Sex",
    "SubscriptionEvent",
    "TargetReason",
    "Theme",
    "User",
    "UserProfile",
    "UserSettings",
    "WaterLog",
    "WeeklyReport",
    "WeightSource",
    "WeightUnit",
    "Workout",
    "WorkoutComment",
    "WorkoutExercise",
    "WorkoutLike",
    "WorkoutSet",
    "WorkoutVisibility",
    "exercise_secondary_muscles",
    "workout_muscle_sets",
]
