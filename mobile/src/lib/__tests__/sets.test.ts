import type { ExerciseType } from '@/api/types';

import { loadHeader, setInputs, setLabels } from '../sets';

describe('setLabels', () => {
  it('numbers normal sets and letters the rest', () => {
    expect(
      setLabels(['warmup', 'warmup', 'normal', 'normal', 'drop', 'failure', 'normal']),
    ).toEqual(['W', 'W', '1', '2', 'D', 'F', '3']);
  });
});

describe('setInputs', () => {
  it.each<[ExerciseType, string]>([
    ['weight_reps', 'load reps'],
    ['bodyweight_reps', 'reps'],
    ['weighted_bodyweight', 'added reps'],
    ['assisted_bodyweight', 'assist reps'],
    ['duration', 'duration'],
    ['distance_duration', 'duration distance'],
  ])('%s → %s', (type, expected) => {
    const inputs = setInputs(type);
    const shown = [
      inputs.load,
      inputs.reps ? 'reps' : null,
      inputs.duration ? 'duration' : null,
      inputs.distance ? 'distance' : null,
    ].filter(Boolean);
    expect(shown.join(' ')).toBe(expected);
  });
});

describe('loadHeader', () => {
  it('marks added and assisting weight', () => {
    expect(loadHeader('load', 'kg')).toBe('kg');
    expect(loadHeader('added', 'lb')).toBe('+lb');
    expect(loadHeader('assist', 'kg')).toBe('−kg');
  });
});
