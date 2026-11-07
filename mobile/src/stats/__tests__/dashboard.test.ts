import type { WeekStats } from '@/api/types';

import { formatHours, muscleIntensities, weekLabels, weekValues } from '../dashboard';

const week = (start: string, workouts: number): WeekStats => ({
  week_start: start,
  workouts,
  duration_s: workouts * 5400,
  volume_kg: workouts * 1000,
  sets: workouts * 15,
});

describe('dashboard helpers', () => {
  const weeks = [week('2026-10-05', 2), week('2026-10-12', 0), week('2026-10-19', 3)];

  it('picks the bar values for a metric', () => {
    expect(weekValues(weeks, 'workouts')).toEqual([2, 0, 3]);
    expect(weekValues(weeks, 'duration')).toEqual([3, 0, 4.5]);
    expect(weekValues(weeks, 'volume')).toEqual([2000, 0, 3000]);
  });

  it('labels every bar when there are few, and thins them out from the latest', () => {
    expect(weekLabels(weeks).every(Boolean)).toBe(true);
    const many = Array.from({ length: 13 }, (_, i) =>
      week(`2026-${String(8 + Math.floor(i / 4)).padStart(2, '0')}-0${(i % 4) + 1}`, 1),
    );
    const labels = weekLabels(many);
    expect(labels.filter(Boolean).length).toBeLessThanOrEqual(7);
    expect(labels.at(-1)).not.toBe('');
  });

  it('adds up muscles that share a body-map region', () => {
    expect(
      muscleIntensities({
        range: '1m',
        muscles: [
          { slug: 'lats', name: 'Lats', body_map_key: 'upper-back', sets: 4 },
          { slug: 'upper_back', name: 'Upper Back', body_map_key: 'upper-back', sets: 2 },
          { slug: 'chest', name: 'Chest', body_map_key: 'chest', sets: 6 },
        ],
      }),
    ).toEqual({ 'upper-back': 6, chest: 6 });
  });

  it('formats time', () => {
    expect(formatHours(45 * 60)).toBe('45 min');
    expect(formatHours(5400)).toBe('1 h 30 min');
    expect(formatHours(7200)).toBe('2 h');
  });
});
