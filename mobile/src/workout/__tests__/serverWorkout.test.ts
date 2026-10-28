import type { Workout } from '@/api/types';
import { makeSet, makeWorkoutExercise } from '@/test/workouts';

import { createMemoryHistoryRepo, type SavedWorkout } from '../history';
import { fromServerWorkout, toWorkoutPut } from '../serverWorkout';

const SERVER: Workout = {
  id: 'w-1',
  routine_id: null,
  title: 'Push',
  notes: 'Strong',
  started_at: '2026-10-27T17:00:00Z',
  ended_at: '2026-10-27T18:00:00Z',
  duration_s: 3600,
  visibility: 'public',
  total_volume_kg: 640,
  total_sets: 1,
  exercises: [
    {
      id: 'we-9',
      exercise_id: 'bench',
      exercise_name: 'Bench Press (Barbell)',
      exercise_type: 'weight_reps',
      superset_group: null,
      notes: '',
      sets: [
        {
          id: 's-9',
          set_type: 'normal',
          weight_kg: 80,
          reps: 8,
          duration_s: null,
          distance_m: null,
          rpe: null,
          completed: true,
        },
      ],
    },
  ],
  muscle_sets: { chest: 1, triceps: 0.5 },
  records: [
    {
      exercise_id: 'bench',
      record_type: 'heaviest',
      value: 80,
      previous_value: 77.5,
      set_id: 's-9',
    },
  ],
  version: 2,
  created_at: '2026-10-27T18:01:00Z',
  updated_at: '2026-10-27T18:02:00Z',
};

describe('server workouts on the device', () => {
  it('stores the server ids, totals and records', () => {
    const stored = fromServerWorkout(SERVER);

    expect(stored).toMatchObject({
      id: 'w-1',
      startedAt: Date.UTC(2026, 9, 27, 17, 0, 0),
      endedAt: Date.UTC(2026, 9, 27, 18, 0, 0),
      volumeKg: 640,
      setCount: 1,
      muscleSets: { chest: 1, triceps: 0.5 },
    });
    expect(stored.exercises[0]).toMatchObject({ id: 'we-9', name: 'Bench Press (Barbell)' });
    expect(stored.exercises[0]?.sets[0]).toMatchObject({
      id: 's-9',
      weightKg: 80,
      completed: true,
    });
    expect(stored.records).toEqual([
      {
        exerciseId: 'bench',
        type: 'heaviest',
        value: 80,
        workoutId: 'w-1',
        setId: 's-9',
        previous: 77.5,
        achievedAt: Date.UTC(2026, 9, 27, 18, 0, 0),
      },
    ]);
  });

  it('round-trips through the PUT body', () => {
    const put = toWorkoutPut(fromServerWorkout(SERVER));

    expect(put).toEqual({
      title: 'Push',
      notes: 'Strong',
      routine_id: null,
      started_at: '2026-10-27T17:00:00.000Z',
      ended_at: '2026-10-27T18:00:00.000Z',
      visibility: 'public',
      exercises: [
        {
          exercise_id: 'bench',
          superset_group: null,
          notes: '',
          sets: [
            {
              set_type: 'normal',
              weight_kg: 80,
              reps: 8,
              duration_s: null,
              distance_m: null,
              rpe: null,
              completed: true,
            },
          ],
        },
      ],
    });
  });
});

describe('memory history repo and sync', () => {
  const local: SavedWorkout = {
    id: 'w-1',
    routineId: null,
    title: 'Logged offline',
    notes: '',
    startedAt: 0,
    endedAt: 3_600_000,
    visibility: 'public',
    volumeKg: 0,
    setCount: 1,
    exercises: [makeWorkoutExercise({ sets: [makeSet({ completed: true })] })],
  };

  it('replaces a local workout with the server copy and counts it as synced', async () => {
    const repo = createMemoryHistoryRepo();
    await repo.save(local, { muscleSets: {}, records: [] });
    await repo.save({ ...local, id: 'w-2' }, { muscleSets: {}, records: [] });
    expect((await repo.unsynced()).map((w) => w.id)).toEqual(['w-1', 'w-2']);

    await repo.putServerWorkout(SERVER);

    expect((await repo.load('w-1'))?.title).toBe('Push');
    expect(repo.sync.get('w-1')).toMatchObject({ version: 2 });
    expect((await repo.unsynced()).map((w) => w.id)).toEqual(['w-2']);

    await repo.remove('w-2');
    expect(await repo.load('w-2')).toBeNull();
    await repo.clear();
    expect(await repo.load('w-1')).toBeNull();
  });
});
