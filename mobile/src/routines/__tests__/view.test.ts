import { makeFolder, makeRoutine, makeRoutineExercise } from '@/test/routines';

import { exerciseSummary, groupRoutines, moveId, routinePreview } from '../view';

describe('groupRoutines', () => {
  it('puts loose routines first, then folders in order, empty ones too', () => {
    const upper = makeFolder({ name: 'Upper', position: 1 });
    const legs = makeFolder({ name: 'Legs', position: 0 });
    const routines = [
      makeRoutine({ name: 'Push', folder_id: upper.id, position: 1 }),
      makeRoutine({ name: 'Pull', folder_id: upper.id, position: 0 }),
      makeRoutine({ name: 'Full body', position: 0 }),
      makeRoutine({ name: 'Orphan', folder_id: 'f-gone', position: 1 }),
    ];

    const sections = groupRoutines(routines, [upper, legs]);

    expect(sections.map((s) => [s.folder?.name ?? null, s.routines.map((r) => r.name)])).toEqual([
      [null, ['Full body', 'Orphan']],
      ['Legs', []],
      ['Upper', ['Pull', 'Push']],
    ]);
  });

  it('shows one empty section when there is nothing yet', () => {
    expect(groupRoutines([], [])).toEqual([{ folder: null, routines: [] }]);
  });

  it('leaves out the loose section when every routine is in a folder', () => {
    const folder = makeFolder({ name: 'Upper' });

    expect(
      groupRoutines([makeRoutine({ name: 'Push', folder_id: folder.id })], [folder]),
    ).toHaveLength(1);
  });
});

describe('routinePreview', () => {
  it('lists the first exercises', () => {
    const names = ['A', 'B', 'C', 'D', 'E'].map((n) => makeRoutineExercise({ exercise_name: n }));

    expect(routinePreview(makeRoutine({ name: 'R', exercises: names.slice(0, 2) }))).toBe('A, B');
    expect(routinePreview(makeRoutine({ name: 'R', exercises: names }))).toBe('A, B, C +2 more');
    expect(routinePreview(makeRoutine({ name: 'R', exercises: [] }))).toBe('No exercises yet');
  });
});

describe('exerciseSummary', () => {
  it.each([
    [{}, '3 sets · 8–12 reps · Rest 1:30'],
    [{ rest_seconds: 120, rep_range_min: 5, rep_range_max: 5 }, '3 sets · 5 reps · Rest 2:00'],
    [{ rep_range_max: null }, '3 sets · 8+ reps · Rest 1:30'],
    [{ rep_range_min: null }, '3 sets · up to 12 reps · Rest 1:30'],
    [{ rep_range_min: null, rep_range_max: null, rest_seconds: 0 }, '3 sets · No rest timer'],
    [{ sets: [], rep_range_min: null, rep_range_max: null }, '0 sets · Rest 1:30'],
  ])('%p → %p', (overrides, expected) => {
    expect(exerciseSummary(makeRoutineExercise(overrides), 90)).toBe(expected);
  });

  it('says "1 set"', () => {
    const one = makeRoutineExercise();
    expect(exerciseSummary({ ...one, sets: one.sets.slice(0, 1) }, 90)).toMatch(/^1 set ·/);
  });
});

describe('moveId', () => {
  it('moves one place and refuses the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b'], 'a', -1)).toBeNull();
    expect(moveId(['a', 'b'], 'b', 1)).toBeNull();
    expect(moveId(['a'], 'x', 1)).toBeNull();
  });
});
