/** Rest timer rules: pure, so they are tested without timers or notifications. */
import type { ActiveWorkout, WorkoutExercise } from './types';

export const REST_STEP_S = 15;
/** Routine value → the user's default → 90 s (PLAN.md G2). */
export const FALLBACK_REST_S = 90;

export function restSecondsFor(
  exercise: WorkoutExercise,
  defaultRestS: number | undefined,
): number {
  return exercise.restSeconds ?? defaultRestS ?? FALLBACK_REST_S;
}

/**
 * Seconds to rest after ticking a set of this exercise; 0 = no timer. In a superset you move
 * straight to the next exercise, so the rest starts after the superset's last exercise, and
 * uses that exercise's rest time.
 */
export function restAfterSet(
  workout: ActiveWorkout,
  exerciseId: string,
  defaultRestS: number | undefined,
): number {
  const index = workout.exercises.findIndex((e) => e.id === exerciseId);
  const exercise = workout.exercises[index];
  if (!exercise) return 0;
  const next = workout.exercises[index + 1];
  if (exercise.supersetGroup !== null && next?.supersetGroup === exercise.supersetGroup) return 0;
  return Math.max(0, restSecondsFor(exercise, defaultRestS));
}

/** Milliseconds left; never negative. */
export function remainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

/** Whole seconds left, rounded up, so "0:01" shows until the very end. */
export function remainingSeconds(endsAt: number, now: number): number {
  return Math.ceil(remainingMs(endsAt, now) / 1000);
}

/** The new end after ±15 s; null when that leaves no rest (the timer stops). */
export function adjustEnd(endsAt: number, deltaS: number, now: number): number | null {
  const next = Math.max(endsAt, now) + deltaS * 1000;
  return next <= now ? null : next;
}
