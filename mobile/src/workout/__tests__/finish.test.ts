import { makeSet, makeWorkout, makeWorkoutExercise } from '@/test/workouts';

import { finishCheck, toSavedWorkout } from '../finish';

const DETAILS = {
  title: '  Push A ',
  notes: ' felt good ',
  startedAt: 1_000,
  endedAt: 3_601_000,
  visibility: 'followers' as const,
};

describe('finishing', () => {
  it('counts ticked and unticked sets', () => {
    const workout = makeWorkout({
      exercises: [
        makeWorkoutExercise({ sets: [makeSet({ completed: true }), makeSet(), makeSet()] }),
      ],
    });

    expect(finishCheck(workout)).toEqual({ completedSets: 1, unfinishedSets: 2 });
  });

  it('saves only ticked sets and drops empty exercises', () => {
    const kept = makeWorkoutExercise({
      notes: ' grip wider ',
      sets: [makeSet({ weightKg: 100, reps: 5, completed: true }), makeSet({ completed: false })],
    });
    const workout = makeWorkout({
      id: 'w-9',
      routineId: 'r-1',
      exercises: [kept, makeWorkoutExercise({ sets: [makeSet()] })],
    });

    const saved = toSavedWorkout(workout, DETAILS);

    expect(saved).toMatchObject({
      id: 'w-9',
      routineId: 'r-1',
      title: 'Push A',
      notes: 'felt good',
      startedAt: 1_000,
      endedAt: 3_601_000,
      visibility: 'followers',
      volumeKg: 500,
      setCount: 1,
    });
    expect(saved.exercises).toHaveLength(1);
    expect(saved.exercises[0]?.notes).toBe('grip wider');
    expect(saved.exercises[0]?.sets).toHaveLength(1);
  });

  it('keeps the old title when the new one is blank', () => {
    expect(toSavedWorkout(makeWorkout({ title: 'Legs' }), { ...DETAILS, title: '  ' }).title).toBe(
      'Legs',
    );
  });
});
