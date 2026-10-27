/** Turning the live workout into a saved one. Pure; the finish screen does the I/O. */
import type { WorkoutVisibility } from '@/api/types';

import type { SavedWorkout } from './history';
import { workoutStats } from './model';
import type { ActiveWorkout } from './types';

export interface FinishCheck {
  completedSets: number;
  /** Sets not ticked; they are dropped on save. */
  unfinishedSets: number;
}

export function finishCheck(workout: ActiveWorkout): FinishCheck {
  const { completedSets, totalSets } = workoutStats(workout);
  return { completedSets, unfinishedSets: totalSets - completedSets };
}

export interface FinishDetails {
  title: string;
  notes: string;
  startedAt: number;
  endedAt: number;
  visibility: WorkoutVisibility;
}

/** Only ticked sets are kept, and exercises left without any are dropped. */
export function toSavedWorkout(workout: ActiveWorkout, details: FinishDetails): SavedWorkout {
  const exercises = workout.exercises
    .map((e) => ({ ...e, notes: e.notes.trim(), sets: e.sets.filter((s) => s.completed) }))
    .filter((e) => e.sets.length > 0);
  const stats = workoutStats({ ...workout, exercises });
  return {
    id: workout.id,
    routineId: workout.routineId,
    title: details.title.trim() || workout.title,
    notes: details.notes.trim(),
    startedAt: details.startedAt,
    endedAt: details.endedAt,
    visibility: details.visibility,
    volumeKg: Math.round(stats.volumeKg * 100) / 100,
    setCount: stats.completedSets,
    exercises,
  };
}
