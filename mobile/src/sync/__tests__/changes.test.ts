import { makeExercise } from '@/test/library';
import { makeFolder, makeRoutine, makeRoutineExercise } from '@/test/routines';
import { makeSet, makeWorkoutExercise } from '@/test/workouts';
import type { SavedWorkout } from '@/workout/history';

import { deletion, exerciseChange, folderChange, routineChange, workoutChange } from '../changes';

describe('queued changes', () => {
  it('sends an exercise as its editable fields', () => {
    const exercise = makeExercise({ id: 'x', name: 'Mine', is_custom: true, version: 2 });

    expect(exerciseChange(exercise)).toEqual({
      entity: 'exercise',
      entityId: 'x',
      op: 'upsert',
      baseVersion: 2,
      data: {
        name: 'Mine',
        type: exercise.type,
        equipment: exercise.equipment,
        primary_muscle: exercise.primary_muscle,
        secondary_muscles: exercise.secondary_muscles,
        instructions: exercise.instructions,
      },
    });
  });

  it('marks a row the server has never seen with no base version', () => {
    expect(folderChange(makeFolder({ name: 'New', version: 0, position: 2 }))).toMatchObject({
      baseVersion: null,
      data: { name: 'New', position: 2 },
    });
  });

  it('sends a routine without the names the server fills in', () => {
    const routine = makeRoutine({ name: 'Push', exercises: [makeRoutineExercise({ notes: 'x' })] });

    const { data } = routineChange(routine);

    expect(data).toEqual({
      name: 'Push',
      notes: '',
      folder_id: null,
      position: 0,
      exercises: [
        {
          exercise_id: routine.exercises[0]?.exercise_id,
          superset_group: null,
          rest_seconds: null,
          rep_range_min: 8,
          rep_range_max: 12,
          notes: 'x',
          sets: routine.exercises[0]?.sets,
        },
      ],
    });
  });

  it('sends a workout as the PUT body, with supersets the server accepts', () => {
    const start = Date.UTC(2026, 9, 27, 17, 0, 0);
    const workout: SavedWorkout = {
      id: 'w',
      routineId: 'r',
      title: 'Push',
      notes: '',
      startedAt: start,
      endedAt: start + 3_600_000,
      visibility: 'private',
      volumeKg: 640,
      setCount: 1,
      exercises: [
        makeWorkoutExercise({
          supersetGroup: 1,
          sets: [makeSet({ weightKg: 80, reps: 8, rpe: 8.5, completed: true })],
        }),
        makeWorkoutExercise({ supersetGroup: null, sets: [makeSet({ completed: true })] }),
        makeWorkoutExercise({ supersetGroup: 1, sets: [makeSet({ completed: true })] }),
      ],
    };

    const { data, baseVersion } = workoutChange(workout, 3);

    expect(baseVersion).toBe(3);
    expect(data).toMatchObject({
      title: 'Push',
      routine_id: 'r',
      started_at: '2026-10-27T17:00:00.000Z',
      ended_at: '2026-10-27T18:00:00.000Z',
      visibility: 'private',
    });
    const exercises = (data as { exercises: { superset_group: number | null }[] }).exercises;
    // A lone group member is not a superset.
    expect(exercises.map((e) => e.superset_group)).toEqual([null, null, null]);
    expect((data as { exercises: { sets: unknown[] }[] }).exercises[0]?.sets[0]).toEqual({
      set_type: 'normal',
      weight_kg: 80,
      reps: 8,
      duration_s: null,
      distance_m: null,
      rpe: 8.5,
      completed: true,
    });
  });

  it('deletes by id', () => {
    expect(deletion('routine', 'r')).toEqual({
      entity: 'routine',
      entityId: 'r',
      op: 'delete',
      baseVersion: null,
      data: null,
    });
  });
});
