"""Double progression, by hand (CLAUDE.md §4.2 B)."""

import pytest

from app.db.models import ExerciseType, OverloadRule, WeightUnit
from app.services.overload import DoneSet, Plan, TargetSet, e1rm, step_down, step_up, suggest

BARBELL = Plan(ExerciseType.WEIGHT_REPS, rep_min=8, rep_max=12, increment_kg=2.5)
BODYWEIGHT = Plan(ExerciseType.BODYWEIGHT_REPS, rep_min=8, rep_max=12, increment_kg=None)
ASSISTED = Plan(ExerciseType.ASSISTED_BODYWEIGHT, rep_min=8, rep_max=12, increment_kg=5.0)


def sets(weight: float | None, *reps: int, rpe: float | None = None) -> list[DoneSet]:
    return [DoneSet(weight, r, rpe) for r in reps]


def test_epley() -> None:
    assert e1rm(100, 5) == pytest.approx(116.67, abs=0.01)
    assert e1rm(60, 30) == 120


def test_all_sets_at_the_top_add_weight_and_restart_at_the_bottom() -> None:
    result = suggest([sets(60, 12, 12, 12, rpe=8)], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.INCREASE_WEIGHT
    assert result.sets == (TargetSet(62.5, 8),) * 3


def test_missing_rpe_counts_as_eight() -> None:
    result = suggest([sets(60, 12, 12)], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.INCREASE_WEIGHT


@pytest.mark.parametrize("rpe", [8.5, 9, 10])
def test_a_hard_top_set_holds_the_weight(rpe: float) -> None:
    result = suggest([[*sets(60, 12, rpe=8), *sets(60, 12, rpe=rpe)]], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS
    assert result.sets == (TargetSet(60, 12),) * 2


def test_within_the_range_the_weakest_set_gets_a_rep() -> None:
    result = suggest([sets(60, 11, 10, 9)], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS
    assert [s.reps for s in result.sets] == [11, 10, 10]
    assert {s.weight_kg for s in result.sets} == {60}


def test_below_the_range_twice_takes_weight_off() -> None:
    result = suggest([sets(100, 6, 6, 5), sets(100, 7, 6, 6)], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.REDUCE_WEIGHT
    # 7.5 % off 100 kg is 92.5, already loadable.
    assert result.sets == (TargetSet(92.5, 8),) * 3


def test_below_the_range_once_is_not_enough() -> None:
    result = suggest([sets(100, 6, 6, 5), sets(100, 9, 8, 8)], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS


def test_one_failed_last_set_is_not_a_bad_session() -> None:
    result = suggest([sets(100, 10, 9, 4), sets(100, 10, 9, 4)], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS


def stalled() -> list[list[DoneSet]]:
    """Four sessions, newest first; the oldest set the best estimate."""
    return [sets(60, 9, 9, 9), sets(60, 9, 9, 8), sets(60, 9, 9, 9), sets(60, 10, 10, 10)]


def test_no_e1rm_gain_in_three_sessions_means_a_deload() -> None:
    result = suggest(stalled(), BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.DELOAD
    # 10 % off, down to a loadable 52.5, and one set fewer.
    assert result.sets == (TargetSet(52.5, 9),) * 2


def test_a_plateau_needs_something_to_compare_with() -> None:
    result = suggest(stalled()[:3], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS


def test_improving_is_not_a_plateau() -> None:
    result = suggest([sets(60, 11, 10, 10), *stalled()[1:]], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS


def test_stalling_again_after_a_deload_suggests_a_variation() -> None:
    plan = Plan(ExerciseType.WEIGHT_REPS, 8, 12, 2.5, previous_rule=OverloadRule.DELOAD)

    result = suggest(stalled(), plan)

    assert result is not None
    assert result.rule == OverloadRule.SWAP
    assert [s.weight_kg for s in result.sets] == [60, 60, 60]


def test_a_deload_keeps_at_least_one_set() -> None:
    history = [sets(60, 9), sets(60, 9), sets(60, 9), sets(60, 10)]

    result = suggest(history, BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.DELOAD
    assert len(result.sets) == 1


def test_moving_up_beats_a_plateau() -> None:
    history = [sets(60, 12, 12), *stalled()]
    plan = Plan(ExerciseType.WEIGHT_REPS, 8, 12, 2.5)

    result = suggest(history, plan)

    assert result is not None
    assert result.rule == OverloadRule.INCREASE_WEIGHT


def test_e1rm_comes_from_the_best_set_and_flags_high_reps() -> None:
    plain = suggest([sets(60, 10, 8)], BARBELL)
    high = suggest([sets(40, 15)], BARBELL)

    assert plain is not None
    assert high is not None
    assert plain.e1rm_kg == 80
    assert plain.e1rm_low_accuracy is False
    assert high.e1rm_kg == 60
    assert high.e1rm_low_accuracy is True


@pytest.mark.parametrize(
    ("increment", "weight", "expected"),
    [(2.5, 60, 62.5), (2.0, 20, 22), (5.0, 45, 50), (1.0, 8, 9)],
)
def test_increments_follow_the_equipment(increment: float, weight: float, expected: float) -> None:
    plan = Plan(ExerciseType.WEIGHT_REPS, 8, 12, increment)

    result = suggest([sets(weight, 12, 12)], plan)

    assert result is not None
    assert result.sets[0].weight_kg == expected


def test_lb_users_move_in_loadable_pounds() -> None:
    plan = Plan(ExerciseType.WEIGHT_REPS, 8, 12, 2.5, unit=WeightUnit.LB)
    # 135 lb.
    result = suggest([sets(61.23, 12, 12)], plan)

    assert result is not None
    # 140 lb, not 135 + 5.5.
    assert result.sets[0].weight_kg == 63.5


@pytest.mark.parametrize(("kg", "pounds"), [(2.5, 5), (2.0, 5), (5.0, 10), (4.0, 10), (1.0, 2.5)])
def test_kg_increments_become_round_pounds(kg: float, pounds: float) -> None:
    plan = Plan(ExerciseType.WEIGHT_REPS, 8, 12, kg, unit=WeightUnit.LB)

    moved = step_up(45.36, kg, plan)  # 100 lb.

    assert moved / 0.45359237 == pytest.approx(100 + pounds, abs=0.02)


def test_lb_users_come_down_to_a_loadable_weight() -> None:
    plan = Plan(ExerciseType.WEIGHT_REPS, 8, 12, 2.5, unit=WeightUnit.LB)

    # 225 lb less 7.5 % is 208.1, so 205.
    assert step_down(102.06, 2.5, plan, 0.075) == pytest.approx(92.99, abs=0.01)


def test_coming_down_is_always_at_least_one_step() -> None:
    assert step_down(10, 5.0, BARBELL, 0.075) == 5
    assert step_down(2.5, 5.0, BARBELL, 0.075) == 0


def test_bodyweight_goes_past_the_range_instead_of_adding_weight() -> None:
    result = suggest([sets(None, 12, 12, rpe=7)], BODYWEIGHT)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS
    assert result.sets == (TargetSet(None, 13),) * 2
    assert result.e1rm_kg is None


def test_bodyweight_within_the_range_adds_a_rep() -> None:
    result = suggest([sets(None, 10, 9)], BODYWEIGHT)

    assert result is not None
    assert result.sets == (TargetSet(None, 10), TargetSet(None, 10))


def test_bodyweight_below_the_range_just_keeps_building() -> None:
    result = suggest([sets(None, 4, 3), sets(None, 4, 3)], BODYWEIGHT)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS


def test_equipment_without_an_increment_progresses_by_reps() -> None:
    plan = Plan(ExerciseType.WEIGHT_REPS, 8, 12, None)

    result = suggest([sets(10, 12, 12)], plan)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS
    assert result.sets == (TargetSet(10, 13),) * 2


def test_weighted_bodyweight_works_like_a_barbell() -> None:
    plan = Plan(ExerciseType.WEIGHTED_BODYWEIGHT, 8, 12, 2.5)

    result = suggest([sets(10, 12, 12)], plan)

    assert result is not None
    assert result.sets[0].weight_kg == 12.5
    assert result.e1rm_kg == 14


def test_assisted_moves_up_by_taking_help_away() -> None:
    result = suggest([sets(30, 12, 12)], ASSISTED)

    assert result is not None
    assert result.rule == OverloadRule.INCREASE_WEIGHT
    assert result.sets == (TargetSet(25, 8),) * 2
    assert result.e1rm_kg is None


def test_assisted_struggling_gets_more_help() -> None:
    result = suggest([sets(30, 5, 5), sets(30, 6, 5)], ASSISTED)

    assert result is not None
    assert result.rule == OverloadRule.REDUCE_WEIGHT
    assert result.sets[0].weight_kg == 35


def test_assisted_within_the_range_adds_a_rep() -> None:
    result = suggest([sets(30, 9, 9)], ASSISTED)

    assert result is not None
    assert result.rule == OverloadRule.ADD_REPS


@pytest.mark.parametrize("exercise_type", [ExerciseType.DURATION, ExerciseType.DISTANCE_DURATION])
def test_timed_exercises_get_no_suggestion(exercise_type: ExerciseType) -> None:
    assert suggest([sets(None, 10)], Plan(exercise_type, 8, 12, None)) is None


def test_no_history_means_no_suggestion() -> None:
    assert suggest([], BARBELL) is None
    assert suggest([[], []], BARBELL) is None


def test_a_loaded_exercise_logged_without_weight_has_no_estimate() -> None:
    result = suggest([sets(None, 9, 9)], BARBELL)

    assert result is not None
    assert result.e1rm_kg is None


def test_sessions_without_working_sets_are_skipped() -> None:
    result = suggest([[], sets(60, 12, 12)], BARBELL)

    assert result is not None
    assert result.rule == OverloadRule.INCREASE_WEIGHT
