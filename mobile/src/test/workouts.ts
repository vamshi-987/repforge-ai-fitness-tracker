import type { ActiveWorkout, WorkoutExercise, WorkoutSet } from '@/workout/types';

let counter = 0;

/** Predictable ids for model tests: "id-1", "id-2", … */
export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

export function makeSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  counter += 1;
  return {
    id: `set-${counter}`,
    type: 'normal',
    weightKg: 60,
    reps: 8,
    durationS: null,
    distanceM: null,
    rpe: null,
    completed: false,
    ...overrides,
  };
}

export function makeWorkoutExercise(overrides: Partial<WorkoutExercise> = {}): WorkoutExercise {
  counter += 1;
  return {
    id: `we-${counter}`,
    exerciseId: 'e7b40f5a-46df-5073-9161-a5081fb0e120',
    name: 'Bench Press (Barbell)',
    type: 'weight_reps',
    supersetGroup: null,
    restSeconds: null,
    repRangeMin: null,
    repRangeMax: null,
    notes: '',
    sets: [makeSet(), makeSet()],
    ...overrides,
  };
}

export function makeWorkout(overrides: Partial<ActiveWorkout> = {}): ActiveWorkout {
  return {
    id: 'w-1',
    routineId: null,
    title: 'Evening workout',
    notes: '',
    startedAt: Date.UTC(2026, 9, 27, 18, 0, 0),
    exercises: [makeWorkoutExercise()],
    ...overrides,
  };
}
