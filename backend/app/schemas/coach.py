import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.db.models import OverloadRule
from app.services.nutrition_engine import WeekStatus


class SuggestedTargets(BaseModel):
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int


class WeeklyReportOut(BaseModel):
    id: uuid.UUID
    week_start: date
    status: WeekStatus
    # All null until two weeks have 3 weigh-ins each.
    avg_weight_kg: float | None
    prev_avg_weight_kg: float | None
    change_kg: float | None
    rate_pct: float | None
    target_rate_min_pct: float
    target_rate_max_pct: float
    weigh_ins: int
    current_targets: SuggestedTargets | None
    suggested_targets: SuggestedTargets | None
    delta_kcal: int
    tdee_kcal: int | None
    # "adaptive" from logged intake and weight, "estimate" from Mifflin-St Jeor.
    tdee_source: str | None
    avg_kcal_logged: float | None
    avg_protein_g: float | None
    days_logged: int
    workouts: int
    # Show the check-in card: no more cuts, and a professional is suggested.
    check_in: bool
    # Calories stopped at the safety floor.
    floor_hit: bool
    headline: str
    tips: list[str]
    # False when the tips are templates.
    ai_written: bool
    applied: bool
    created_at: datetime


class TargetSetOut(BaseModel):
    # Null for exercises without a load. For assisted ones it is the assistance.
    weight_kg: float | None
    reps: int


class OverloadOut(BaseModel):
    exercise_id: uuid.UUID
    rule: OverloadRule
    sets: list[TargetSetOut]
    rep_min: int
    rep_max: int
    e1rm_kg: float | None
    # Estimated from more than 12 reps, where Epley gets unreliable.
    e1rm_low_accuracy: bool
    explanation: str
    generated_at: datetime


class OverloadList(BaseModel):
    items: list[OverloadOut]
