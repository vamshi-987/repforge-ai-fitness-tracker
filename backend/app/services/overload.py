"""Progressive overload by double progression (CLAUDE.md §4.2 B). Pure functions: everything an
exercise's next target depends on comes in as arguments.

In order: ready to move up, stuck under the range, plateaued, otherwise add a rep. A plateau is
measured on estimated 1RM, so it applies to loaded exercises only.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median

from app.db.models import ExerciseType, OverloadRule, WeightUnit

KG_PER_LB = 0.45359237
MISSING_RPE = 8.0
MAX_RPE_TO_PROGRESS = 8.0
LOW_ACCURACY_REPS = 12
# Below the range two sessions in a row: 5-10 % off, so the middle.
REDUCE_FRACTION = 0.075
DELOAD_FRACTION = 0.10
SESSIONS_BELOW_RANGE = 2
PLATEAU_SESSIONS = 3
LB_STEP = 2.5

COUNTED_IN_REPS = {
    ExerciseType.WEIGHT_REPS,
    ExerciseType.BODYWEIGHT_REPS,
    ExerciseType.WEIGHTED_BODYWEIGHT,
    ExerciseType.ASSISTED_BODYWEIGHT,
}
# Weight here is load on the bar; for assisted exercises it is help, so less is harder.
LOADED = {ExerciseType.WEIGHT_REPS, ExerciseType.WEIGHTED_BODYWEIGHT}


@dataclass(frozen=True)
class DoneSet:
    weight_kg: float | None
    reps: int
    rpe: float | None = None


@dataclass(frozen=True)
class Plan:
    exercise_type: ExerciseType
    rep_min: int
    rep_max: int
    # None: this equipment progresses by reps (bodyweight, bands).
    increment_kg: float | None
    unit: WeightUnit = WeightUnit.KG
    # What was suggested last time; a second plateau after a deload means swap.
    previous_rule: OverloadRule | None = None


@dataclass(frozen=True)
class TargetSet:
    weight_kg: float | None
    reps: int


@dataclass(frozen=True)
class Suggestion:
    rule: OverloadRule
    sets: tuple[TargetSet, ...]
    e1rm_kg: float | None
    e1rm_low_accuracy: bool


def e1rm(weight_kg: float, reps: int) -> float:
    """Epley."""
    return weight_kg * (1 + reps / 30)


def _best_e1rm(sets: Sequence[DoneSet]) -> tuple[float, bool] | None:
    """The session's best estimate, and whether it came from more than 12 reps."""
    loaded = [(e1rm(s.weight_kg, s.reps), s.reps) for s in sets if s.weight_kg]
    if not loaded:
        return None
    best, reps = max(loaded)
    return best, reps > LOW_ACCURACY_REPS


def _unit_step(plan: Plan, increment_kg: float) -> float:
    """The smallest step in the user's unit: 2.5 kg, or 5 lb rather than 5.5."""
    if plan.unit == WeightUnit.KG:
        return increment_kg
    return max(LB_STEP, round(increment_kg / KG_PER_LB / LB_STEP) * LB_STEP)


def _in_unit(kg: float, plan: Plan) -> float:
    return kg if plan.unit == WeightUnit.KG else round(kg / KG_PER_LB, 1)


def _to_kg(value: float, plan: Plan) -> float:
    return round(value if plan.unit == WeightUnit.KG else value * KG_PER_LB, 2)


def step_up(weight_kg: float, increment_kg: float, plan: Plan) -> float:
    return _to_kg(_in_unit(weight_kg, plan) + _unit_step(plan, increment_kg), plan)


def step_down(weight_kg: float, increment_kg: float, plan: Plan, fraction: float) -> float:
    """`fraction` off, down to something loadable, and always at least one step."""
    current = _in_unit(weight_kg, plan)
    step = _unit_step(plan, increment_kg)
    lower = math.floor(current * (1 - fraction) / step) * step
    return _to_kg(max(0.0, min(lower, current - step)), plan)


def _ready_to_move_up(sets: Sequence[DoneSet], plan: Plan) -> bool:
    return all(
        s.reps >= plan.rep_max
        and (s.rpe if s.rpe is not None else MISSING_RPE) <= MAX_RPE_TO_PROGRESS
        for s in sets
    )


def _below_range(sets: Sequence[DoneSet], plan: Plan) -> bool:
    """By the middle set, so one failed last set doesn't count as a bad session."""
    return median(s.reps for s in sets) < plan.rep_min


def _plateaued(sessions: Sequence[Sequence[DoneSet]]) -> bool:
    """The last 3 sessions beat nothing that came before them."""
    if len(sessions) <= PLATEAU_SESSIONS:
        return False
    best = [_best_e1rm(sets) for sets in sessions]
    recent = [b[0] for b in best[:PLATEAU_SESSIONS] if b]
    earlier = [b[0] for b in best[PLATEAU_SESSIONS:] if b]
    return bool(recent and earlier) and max(recent) <= max(earlier)


def _add_rep(sets: Sequence[DoneSet], plan: Plan) -> tuple[TargetSet, ...]:
    """The weakest set gets one more rep, as long as it's still under the top of the range."""
    weakest = min(range(len(sets)), key=lambda i: sets[i].reps)
    return tuple(
        TargetSet(s.weight_kg, s.reps + 1 if i == weakest and s.reps < plan.rep_max else s.reps)
        for i, s in enumerate(sets)
    )


def _all_at(sets: Sequence[DoneSet], weight_kg: float, reps: int) -> tuple[TargetSet, ...]:
    return tuple(TargetSet(weight_kg, reps) for _ in sets)


def _heaviest(sets: Sequence[DoneSet]) -> float:
    return max(s.weight_kg or 0.0 for s in sets)


def _lightest(sets: Sequence[DoneSet]) -> float:
    return min(s.weight_kg or 0.0 for s in sets)


def _by_reps(sets: Sequence[DoneSet], plan: Plan) -> tuple[OverloadRule, tuple[TargetSet, ...]]:
    """No load to change: reps go past the range once it's done (or a weight vest, in words)."""
    if _ready_to_move_up(sets, plan):
        return OverloadRule.ADD_REPS, tuple(TargetSet(s.weight_kg, s.reps + 1) for s in sets)
    return OverloadRule.ADD_REPS, _add_rep(sets, plan)


def _assisted(
    sessions: Sequence[Sequence[DoneSet]], plan: Plan, increment_kg: float
) -> tuple[OverloadRule, tuple[TargetSet, ...]]:
    """Weight is help here, so the directions flip: moving up means taking help away."""
    last = sessions[0]
    if _ready_to_move_up(last, plan):
        help_left = step_down(_lightest(last), increment_kg, plan, 0.0)
        return OverloadRule.INCREASE_WEIGHT, _all_at(last, help_left, plan.rep_min)
    recent = sessions[:SESSIONS_BELOW_RANGE]
    if len(recent) == SESSIONS_BELOW_RANGE and all(_below_range(s, plan) for s in recent):
        more_help = step_up(_heaviest(last), increment_kg, plan)
        return OverloadRule.REDUCE_WEIGHT, _all_at(last, more_help, plan.rep_min)
    return OverloadRule.ADD_REPS, _add_rep(last, plan)


def _loaded(
    sessions: Sequence[Sequence[DoneSet]], plan: Plan, increment_kg: float
) -> tuple[OverloadRule, tuple[TargetSet, ...]]:
    last = sessions[0]
    heaviest = _heaviest(last)
    if _ready_to_move_up(last, plan):
        heavier = step_up(heaviest, increment_kg, plan)
        return OverloadRule.INCREASE_WEIGHT, _all_at(last, heavier, plan.rep_min)
    recent = sessions[:SESSIONS_BELOW_RANGE]
    if len(recent) == SESSIONS_BELOW_RANGE and all(_below_range(s, plan) for s in recent):
        lighter = step_down(heaviest, increment_kg, plan, REDUCE_FRACTION)
        return OverloadRule.REDUCE_WEIGHT, _all_at(last, lighter, plan.rep_min)
    if _plateaued(sessions):
        if plan.previous_rule == OverloadRule.DELOAD:
            return OverloadRule.SWAP, tuple(TargetSet(s.weight_kg, s.reps) for s in last)
        lighter = step_down(heaviest, increment_kg, plan, DELOAD_FRACTION)
        reps = min(max(s.reps for s in last), plan.rep_max)
        return OverloadRule.DELOAD, _all_at(last[: max(1, len(last) - 1)], lighter, reps)
    return OverloadRule.ADD_REPS, _add_rep(last, plan)


def suggest(sessions: Sequence[Sequence[DoneSet]], plan: Plan) -> Suggestion | None:
    """`sessions`: working sets per session, newest first. None without anything to go on."""
    usable = [list(s) for s in sessions if s]
    if plan.exercise_type not in COUNTED_IN_REPS or not usable:
        return None
    increment = plan.increment_kg
    if plan.exercise_type == ExerciseType.BODYWEIGHT_REPS or increment is None:
        rule, sets = _by_reps(usable[0], plan)
    elif plan.exercise_type == ExerciseType.ASSISTED_BODYWEIGHT:
        rule, sets = _assisted(usable, plan, increment)
    else:
        rule, sets = _loaded(usable, plan, increment)
    best = _best_e1rm(usable[0]) if plan.exercise_type in LOADED else None
    return Suggestion(
        rule=rule,
        sets=sets,
        e1rm_kg=round(best[0], 1) if best else None,
        e1rm_low_accuracy=best[1] if best else False,
    )
