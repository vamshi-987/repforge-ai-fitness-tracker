import type { OverloadSuggestion, SetType } from '@/api/types';
import type { WorkoutExercise, WorkoutSet } from '@/workout/types';

import { setSuggestion } from '../overload';

const KG = { weight: 'kg', length: 'cm' } as const;
const LB = { weight: 'lb', length: 'in' } as const;

function set(type: SetType, completed = false): WorkoutSet {
  return {
    id: 's',
    type,
    weightKg: null,
    reps: null,
    durationS: null,
    distanceM: null,
    rpe: null,
    completed,
  };
}

function exercise(sets: WorkoutSet[], type: WorkoutExercise['type'] = 'weight_reps') {
  return {
    id: 'e',
    exerciseId: 'bench',
    name: 'Bench',
    type,
    supersetGroup: null,
    restSeconds: null,
    repRangeMin: 8,
    repRangeMax: 12,
    notes: '',
    sets,
  } satisfies WorkoutExercise;
}

const SUGGESTION: OverloadSuggestion = {
  exercise_id: 'bench',
  rule: 'increase_weight',
  sets: [
    { weight_kg: 62.5, reps: 8 },
    { weight_kg: 60, reps: 9 },
  ],
  rep_min: 8,
  rep_max: 12,
  e1rm_kg: 84,
  e1rm_low_accuracy: false,
  explanation: 'Add weight.',
  generated_at: '',
};

describe('the coach’s ghost text', () => {
  it('reads like a target, in the user’s unit', () => {
    const lift = exercise([set('normal')]);

    expect(setSuggestion(lift, 0, SUGGESTION, KG)).toBe('Try 62.5 kg × 8');
    expect(setSuggestion(lift, 0, SUGGESTION, LB)).toMatch(/^Try 137\.\d? ?.*lb × 8$/);
  });

  it('counts working sets, so warm-ups don’t use up a target', () => {
    const lift = exercise([set('warmup'), set('normal'), set('drop'), set('failure')]);

    expect(setSuggestion(lift, 0, SUGGESTION, KG)).toBeNull();
    expect(setSuggestion(lift, 1, SUGGESTION, KG)).toBe('Try 62.5 kg × 8');
    expect(setSuggestion(lift, 2, SUGGESTION, KG)).toBeNull();
    expect(setSuggestion(lift, 3, SUGGESTION, KG)).toBe('Try 60 kg × 9');
  });

  it('stays quiet on finished sets, extra sets and without a suggestion', () => {
    const lift = exercise([set('normal', true), set('normal'), set('normal')]);

    expect(setSuggestion(lift, 0, SUGGESTION, KG)).toBeNull();
    expect(setSuggestion(lift, 1, SUGGESTION, KG)).toBe('Try 60 kg × 9');
    expect(setSuggestion(lift, 2, SUGGESTION, KG)).toBeNull();
    expect(setSuggestion(lift, 0, undefined, KG)).toBeNull();
    expect(setSuggestion(lift, 9, SUGGESTION, KG)).toBeNull();
  });

  it('shows reps alone for bodyweight exercises', () => {
    const bodyweight = { ...SUGGESTION, sets: [{ weight_kg: null, reps: 13 }] };

    expect(setSuggestion(exercise([set('normal')], 'bodyweight_reps'), 0, bodyweight, KG)).toBe(
      'Try 13 reps',
    );
  });
});
