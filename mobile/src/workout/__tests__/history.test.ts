import { makeSet, makeWorkoutExercise } from '@/test/workouts';

import { createMemoryHistoryRepo, type SavedWorkout } from '../history';

function saved(id: string, startedAt: number, exercises: SavedWorkout['exercises']): SavedWorkout {
  return {
    id,
    routineId: null,
    title: id,
    notes: '',
    startedAt,
    endedAt: startedAt + 3_600_000,
    visibility: 'public',
    volumeKg: 0,
    setCount: 0,
    exercises,
  };
}

describe('previousSets', () => {
  it('takes the latest workout that had each exercise', async () => {
    const repo = createMemoryHistoryRepo([
      saved('old', 1, [
        makeWorkoutExercise({
          exerciseId: 'bench',
          sets: [makeSet({ weightKg: 50, completed: true })],
        }),
        makeWorkoutExercise({
          exerciseId: 'row',
          sets: [makeSet({ weightKg: 40, completed: true })],
        }),
      ]),
      saved('new', 2, [
        makeWorkoutExercise({
          exerciseId: 'bench',
          sets: [
            makeSet({ type: 'warmup', weightKg: 40, reps: 10, completed: true }),
            makeSet({ weightKg: 60, reps: 8, completed: true }),
            makeSet({ weightKg: 65, completed: false }),
          ],
        }),
      ]),
    ]);

    const result = await repo.previousSets(['bench', 'row', 'squat', 'bench']);

    expect(result.bench).toEqual([
      { type: 'warmup', weightKg: 40, reps: 10, durationS: null, distanceM: null },
      { type: 'normal', weightKg: 60, reps: 8, durationS: null, distanceM: null },
    ]);
    expect(result.row?.[0]?.weightKg).toBe(40);
    expect(result.squat).toBeUndefined();
  });

  it('includes a workout once it is saved', async () => {
    const repo = createMemoryHistoryRepo();
    await repo.save(
      saved('w', 1, [
        makeWorkoutExercise({ exerciseId: 'bench', sets: [makeSet({ completed: true })] }),
      ]),
    );

    expect(Object.keys(await repo.previousSets(['bench']))).toEqual(['bench']);
  });
});
