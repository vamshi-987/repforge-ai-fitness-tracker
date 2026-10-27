import type { ExerciseType, SetType } from '@/api/types';

/** A set as logged. Weights are kg and distances metres, whatever the user's units. */
export interface WorkoutSet {
  id: string;
  type: SetType;
  weightKg: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  /** 6–10 in steps of 0.5; null = not rated (the overload coach assumes 8). */
  rpe: number | null;
  completed: boolean;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  name: string;
  type: ExerciseType;
  supersetGroup: number | null;
  /** From the routine; null = the user's default rest. */
  restSeconds: number | null;
  repRangeMin: number | null;
  repRangeMax: number | null;
  notes: string;
  sets: WorkoutSet[];
}

/** The workout being logged. Lives on the device only until it is finished. */
export interface ActiveWorkout {
  /** Client UUID; the server stores the finished workout under it (idempotent PUT). */
  id: string;
  routineId: string | null;
  title: string;
  notes: string;
  /** Epoch ms (UTC). The timer is `now − startedAt`, never a counter. */
  startedAt: number;
  exercises: WorkoutExercise[];
}
