import { makeSet, makeWorkoutExercise } from '@/test/workouts';

import type { PreviousSet } from '../history';
import {
  bestSetLabel,
  describeSet,
  distanceToMeters,
  fillFromPrevious,
  formatPrevious,
  metersToDistance,
} from '../setValues';

const KG = { weight: 'kg', length: 'cm' } as const;
const LB = { weight: 'lb', length: 'in' } as const;

function prev(overrides: Partial<PreviousSet> = {}): PreviousSet {
  return { type: 'normal', weightKg: 60, reps: 8, durationS: null, distanceM: null, ...overrides };
}

describe('formatPrevious', () => {
  it.each([
    ['weight_reps', prev(), KG, '60 kg × 8'],
    ['weight_reps', prev({ weightKg: 61.23 }), LB, '135 lb × 8'],
    ['weight_reps', prev({ weightKg: null }), KG, '× 8'],
    ['bodyweight_reps', prev({ weightKg: null, reps: 12 }), KG, '× 12'],
    ['weighted_bodyweight', prev({ weightKg: 20 }), KG, '+20 kg × 8'],
    ['assisted_bodyweight', prev({ weightKg: 25 }), KG, '−25 kg × 8'],
    ['duration', prev({ weightKg: null, reps: null, durationS: 90 }), KG, '1:30'],
    [
      'distance_duration',
      prev({ reps: null, distanceM: 5000, durationS: 1500 }),
      KG,
      '5 km · 25:00',
    ],
    [
      'distance_duration',
      prev({ reps: null, distanceM: 1609.344, durationS: 480 }),
      LB,
      '1 mi · 8:00',
    ],
    ['duration', prev({ durationS: null }), KG, '—'],
  ] as const)('%s %p in %p → %p', (type, value, units, expected) => {
    expect(formatPrevious(type, value, units)).toBe(expected);
  });

  it('shows a dash with no previous set', () => {
    expect(formatPrevious('weight_reps', undefined, KG)).toBe('—');
  });
});

describe('fillFromPrevious', () => {
  it('fills only what is empty', () => {
    const set = makeSet({ weightKg: 62.5, reps: null });

    expect(fillFromPrevious(set, prev())).toMatchObject({ weightKg: 62.5, reps: 8 });
    expect(fillFromPrevious(set, undefined)).toBe(set);
  });
});

describe('distances', () => {
  it('converts km and miles both ways', () => {
    expect(metersToDistance(5000, 'cm')).toBe(5);
    expect(distanceToMeters(5, 'cm')).toBe(5000);
    expect(metersToDistance(1609.344, 'in')).toBe(1);
    expect(distanceToMeters(3.1, 'in')).toBe(4989);
  });
});

describe('describeSet', () => {
  it.each([
    ['W', 'Warm-up set'],
    ['D', 'Drop set'],
    ['F', 'Failure set'],
    ['3', 'Set 3'],
  ])('%s → %s', (label, expected) => {
    expect(describeSet(label)).toBe(expected);
  });
});

describe('bestSetLabel', () => {
  it('names the set with the most volume, or the most reps', () => {
    const heavy = makeWorkoutExercise({
      sets: [
        makeSet({ type: 'warmup', weightKg: 40, reps: 10, completed: true }),
        makeSet({ weightKg: 100, reps: 5, completed: true }),
        makeSet({ weightKg: 80, reps: 8, completed: true }),
      ],
    });
    const pushups = makeWorkoutExercise({
      type: 'bodyweight_reps',
      sets: [
        makeSet({ weightKg: null, reps: 20, completed: true }),
        makeSet({ weightKg: null, reps: 25, completed: true }),
      ],
    });
    const plank = makeWorkoutExercise({
      type: 'duration',
      sets: [makeSet({ reps: null, durationS: 90, completed: true })],
    });

    expect(bestSetLabel(heavy, KG)).toBe('Best: 80 kg × 8');
    expect(bestSetLabel(pushups, KG)).toBe('Best: × 25');
    expect(bestSetLabel(plank, KG)).toBe('Best: 1:30');
    expect(bestSetLabel(makeWorkoutExercise({ sets: [] }), KG)).toBeNull();
  });
});
