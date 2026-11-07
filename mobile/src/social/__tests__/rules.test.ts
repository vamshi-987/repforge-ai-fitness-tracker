import type { FeedWorkout } from '@/api/types';

import { exerciseLine, followLabel, whenLabel, workoutLine } from '../rules';

const NOW = Date.parse('2026-11-07T12:00:00.000Z');

const WORKOUT: FeedWorkout = {
  id: 'w',
  user: { id: 'u', username: 'ana', display_name: 'Ana', avatar_url: null },
  title: 'Push',
  notes: '',
  started_at: '2026-11-07T09:00:00.000Z',
  ended_at: '2026-11-07T10:05:00.000Z',
  total_volume_kg: 3200,
  total_sets: 18,
  visibility: 'public',
  exercises: [
    { name: 'Bench', sets: 4 },
    { name: 'Press', sets: 3 },
    { name: 'Dip', sets: 3 },
    { name: 'Fly', sets: 3 },
    { name: 'Curl', sets: 3 },
  ],
  like_count: 0,
  comment_count: 0,
  liked: false,
};

describe('feed text', () => {
  it('says how long ago today, and the date after that', () => {
    expect(whenLabel('2026-11-07T10:00:00.000Z', NOW)).toBe('2 h ago');
    expect(whenLabel('2026-11-01T10:00:00.000Z', NOW)).toMatch(/Nov/);
  });

  it('sums a workout up in one line', () => {
    expect(workoutLine(WORKOUT, 'kg')).toMatch(/^1 h 5 min · 18 sets · 3200/);
    expect(workoutLine({ ...WORKOUT, total_sets: 1 }, 'kg')).toContain('1 set ');
  });

  it('lists three exercises and counts the rest', () => {
    expect(exerciseLine(WORKOUT)).toBe('Bench × 4, Press × 3, Dip × 3 and 2 more');
    expect(exerciseLine({ ...WORKOUT, exercises: WORKOUT.exercises.slice(0, 2) })).toBe(
      'Bench × 4, Press × 3',
    );
  });

  it('names each follow state', () => {
    expect(followLabel('none')).toBe('Follow');
    expect(followLabel('requested')).toBe('Requested');
    expect(followLabel('following')).toBe('Following');
  });
});
