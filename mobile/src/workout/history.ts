import type { SetType, WorkoutVisibility } from '@/api/types';

import type { WorkoutExercise } from './types';

/** A finished workout as stored on the device (only completed sets). */
export interface SavedWorkout {
  id: string;
  routineId: string | null;
  title: string;
  notes: string;
  startedAt: number;
  endedAt: number;
  visibility: WorkoutVisibility;
  volumeKg: number;
  setCount: number;
  exercises: WorkoutExercise[];
}

/** One set from the last session of an exercise, for the "Previous" column. */
export interface PreviousSet {
  type: SetType;
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
}

/** The device's workout history. SQLite in the app, in memory in tests. */
export interface HistoryRepo {
  /** Exercise id → the sets of the latest finished workout that included it, in order. */
  previousSets(exerciseIds: string[]): Promise<Record<string, PreviousSet[]>>;
  save(workout: SavedWorkout): Promise<void>;
}

const toPrevious = ({ type, weightKg, reps, durationS, distanceM }: PreviousSet): PreviousSet => ({
  type,
  weightKg,
  reps,
  durationS,
  distanceM,
});

export function createMemoryHistoryRepo(initial: SavedWorkout[] = []): HistoryRepo & {
  workouts: SavedWorkout[];
} {
  const workouts = [...initial];
  return {
    workouts,
    async previousSets(exerciseIds) {
      const latestFirst = [...workouts].sort((a, b) => b.startedAt - a.startedAt);
      const result: Record<string, PreviousSet[]> = {};
      for (const id of new Set(exerciseIds)) {
        for (const workout of latestFirst) {
          const exercise = workout.exercises.find((e) => e.exerciseId === id);
          if (exercise) {
            result[id] = exercise.sets.filter((s) => s.completed).map(toPrevious);
            break;
          }
        }
      }
      return result;
    },
    async save(workout) {
      workouts.push(workout);
    },
  };
}
