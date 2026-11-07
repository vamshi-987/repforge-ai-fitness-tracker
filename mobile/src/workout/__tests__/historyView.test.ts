import { makeSet, makeWorkoutExercise } from '@/test/workouts';

import type { SavedWorkout, WorkoutSummary } from '../history';
import {
  canEdit,
  dayKey,
  dayKeyOf,
  EDIT_WINDOW_MS,
  groupByMonth,
  monthGrid,
  monthOf,
  shiftMonth,
  toDraft,
  workoutsByDay,
} from '../historyView';

const at = (y: number, m: number, d: number, h = 18) => new Date(y, m, d, h).getTime();

function summary(id: string, startedAt: number): WorkoutSummary {
  return {
    id,
    title: id,
    startedAt,
    endedAt: startedAt + 3_600_000,
    volumeKg: 0,
    setCount: 1,
    exerciseNames: [],
    prCount: 0,
  };
}

describe('the edit window', () => {
  it('is open for 24 hours after the end', () => {
    expect(canEdit(0, EDIT_WINDOW_MS)).toBe(true);
    expect(canEdit(0, EDIT_WINDOW_MS + 1)).toBe(false);
  });

  it('turns a saved workout into a draft with every set ticked', () => {
    const saved: SavedWorkout = {
      id: 'w',
      routineId: 'r',
      title: 'Push',
      notes: 'n',
      startedAt: 1,
      endedAt: 2,
      visibility: 'public',
      volumeKg: 0,
      setCount: 1,
      exercises: [makeWorkoutExercise({ sets: [makeSet({ completed: false })] })],
    };

    const draft = toDraft(saved);

    expect(draft).toMatchObject({ id: 'w', routineId: 'r', title: 'Push', startedAt: 1 });
    expect(draft.exercises[0]?.sets[0]?.completed).toBe(true);
  });
});

describe('months and days', () => {
  it('groups the newest-first list by month', () => {
    const sections = groupByMonth([
      summary('c', at(2026, 9, 27)),
      summary('b', at(2026, 9, 2)),
      summary('a', at(2026, 8, 30)),
    ]);

    expect(sections.map((s) => [s.key, s.data.map((w) => w.id)])).toEqual([
      ['2026-9', ['c', 'b']],
      ['2026-8', ['a']],
    ]);
    expect(sections[0]?.title).toMatch(/2026/);
  });

  it('lays out a month Monday first', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = monthGrid({ year: 2026, month: 9 });

    expect(weeks[0]).toEqual([null, null, null, 1, 2, 3, 4]);
    expect(weeks.at(-1)).toEqual([26, 27, 28, 29, 30, 31, null]);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(31);
    // February 2027 starts on a Monday: no leading blanks, exactly 4 weeks.
    expect(monthGrid({ year: 2027, month: 1 })).toHaveLength(4);
  });

  it('moves between months across years', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(monthOf(at(2026, 9, 27))).toEqual({ year: 2026, month: 9 });
  });

  it('finds the workouts of each day, in local time', () => {
    const byDay = workoutsByDay([
      summary('late', at(2026, 9, 27, 20)),
      summary('early', at(2026, 9, 27, 7)),
      summary('other', at(2026, 9, 28, 7)),
    ]);

    expect(dayKey(at(2026, 9, 27, 23))).toBe('2026-10-27');
    expect(byDay.get(dayKeyOf({ year: 2026, month: 9 }, 27))?.map((w) => w.id)).toEqual([
      'early',
      'late',
    ]);
    expect(byDay.get('2026-10-28')).toHaveLength(1);
  });
});
