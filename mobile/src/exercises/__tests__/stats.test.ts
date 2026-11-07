import type { ExercisePoint } from '@/api/types';

import { availableMetrics, describeSeries, series } from '../stats';

function point(overrides: Partial<ExercisePoint>): ExercisePoint {
  return {
    workout_id: 'w',
    started_at: '2026-10-01T17:00:00Z',
    heaviest_kg: null,
    e1rm_kg: null,
    e1rm_low_accuracy: false,
    best_set_volume_kg: null,
    session_volume_kg: null,
    total_reps: null,
    ...overrides,
  };
}

describe('exercise chart data', () => {
  const points = [
    point({ heaviest_kg: 100, e1rm_kg: 116.67, total_reps: 15 }),
    point({
      started_at: '2026-10-08T17:00:00Z',
      e1rm_kg: 90,
      e1rm_low_accuracy: true,
      total_reps: 20,
    }),
  ];

  it('offers only metrics with data', () => {
    expect(availableMetrics(points).map((m) => m.key)).toEqual([
      'heaviest_kg',
      'e1rm_kg',
      'total_reps',
    ]);
    expect(availableMetrics([])).toEqual([]);
  });

  it('turns points into a series, skipping sessions without a value', () => {
    expect(series(points, 'heaviest_kg')).toEqual([
      { x: Date.parse('2026-10-01T17:00:00Z'), y: 100, rough: false },
    ]);
    expect(series(points, 'e1rm_kg').map((d) => d.rough)).toEqual([false, true]);
  });

  it('describes the chart for screen readers', () => {
    const data = series(points, 'total_reps');
    expect(describeSeries('Total reps', data, (v) => `${v} reps`)).toBe(
      'Total reps over 2 sessions: from 15 reps to 20 reps, best 20 reps',
    );
    expect(describeSeries('Total reps', [], String)).toBe('Total reps: no sessions in this range');
  });
});
