import { BENCH, makeExercise } from '@/test/library';
import { makeFolder, makeRoutine, makeRoutineExercise } from '@/test/routines';

import {
  buildRoutine,
  copyName,
  moveOutOfFolder,
  nextFolderPosition,
  nextPosition,
  reorderFolders,
  reorderRoutines,
} from '../local';

const NOW = '2026-10-28T10:00:00.000Z';
const CURL = makeExercise({ id: 'curl', name: 'Curl', type: 'weight_reps' });

describe('buildRoutine', () => {
  it('fills in names and types, repairs supersets and rounds weights', () => {
    const routine = buildRoutine(
      'r',
      {
        name: 'Arms',
        folder_id: null,
        position: 2,
        exercises: [
          { exercise_id: BENCH.id, superset_group: 4, sets: [{ target_weight_kg: 60.004 }] },
          { exercise_id: CURL.id, superset_group: 4 },
          { exercise_id: CURL.id, superset_group: 9 },
        ],
      },
      [BENCH, CURL],
      null,
      NOW,
    );

    expect(routine).toMatchObject({
      id: 'r',
      name: 'Arms',
      notes: '',
      position: 2,
      version: 0,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(routine.exercises.map((e) => [e.exercise_name, e.superset_group])).toEqual([
      [BENCH.name, 1],
      ['Curl', 1],
      ['Curl', null],
    ]);
    expect(routine.exercises[0]?.sets).toEqual([
      { set_type: 'normal', target_weight_kg: 60, target_reps: null, target_duration_s: null },
    ]);
  });

  it('keeps the previous copy for fields not sent, and the name of a deleted exercise', () => {
    const previous = makeRoutine({
      name: 'Push',
      notes: 'old',
      version: 3,
      exercises: [makeRoutineExercise({ exercise_id: 'gone', exercise_name: 'Old Lift' })],
    });

    const renamed = buildRoutine(previous.id, { name: 'Push A' }, [BENCH], previous, NOW);

    expect(renamed).toMatchObject({
      name: 'Push A',
      notes: 'old',
      version: 3,
      created_at: previous.created_at,
      updated_at: NOW,
    });
    expect(renamed.exercises[0]?.exercise_name).toBe('Old Lift');
  });
});

describe('positions', () => {
  const a = makeRoutine({ name: 'A', folder_id: 'f', position: 0 });
  const b = makeRoutine({ name: 'B', folder_id: 'f', position: 1 });
  const c = makeRoutine({ name: 'C', position: 0 });

  it('puts new routines last in their folder', () => {
    expect(nextPosition([a, b, c], 'f')).toBe(2);
    expect(nextPosition([a, b, c], null)).toBe(1);
    expect(nextPosition([], null)).toBe(0);
    expect(nextFolderPosition([makeFolder({ name: 'X', position: 4 })])).toBe(5);
    expect(nextFolderPosition([])).toBe(0);
  });

  it('reorders like the server and returns only what moved', () => {
    expect(reorderRoutines([a, b, c], 'f', [b.id]).map((r) => [r.name, r.position])).toEqual([
      ['B', 0],
      ['A', 1],
    ]);
    // Moving C into the folder first.
    expect(
      reorderRoutines([a, b, c], 'f', [c.id]).map((r) => [r.name, r.folder_id, r.position]),
    ).toEqual([
      ['C', 'f', 0],
      ['A', 'f', 1],
      ['B', 'f', 2],
    ]);
    expect(reorderRoutines([a, b, c], 'f', [a.id, b.id])).toEqual([]);
  });

  it('moves a deleted folder’s routines after those without a folder', () => {
    expect(moveOutOfFolder([b, a, c], 'f').map((r) => [r.name, r.folder_id, r.position])).toEqual([
      ['A', null, 1],
      ['B', null, 2],
    ]);
  });

  it('reorders folders', () => {
    const x = makeFolder({ name: 'X', position: 0 });
    const y = makeFolder({ name: 'Y', position: 1 });
    expect(reorderFolders([x, y], [y.id]).map((f) => [f.name, f.position])).toEqual([
      ['Y', 0],
      ['X', 1],
    ]);
    expect(reorderFolders([x, y], [x.id])).toEqual([]);
  });

  it('names copies like the server', () => {
    expect(copyName('Push')).toBe('Push (Copy)');
    expect(copyName(`${'x'.repeat(78)}  `)).toHaveLength(80);
  });
});
