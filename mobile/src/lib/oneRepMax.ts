/**
 * One-rep max estimates (Epley, the formula used everywhere else in the app) and the weight
 * expected for each rep count at that max.
 */
import { epley, isLowAccuracy } from './e1rm';

export const TABLE_REPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15];

export interface OneRepMax {
  value: number;
  /** More than 12 reps: shown, but marked as a rough estimate. */
  rough: boolean;
}

export function estimateOneRepMax(weight: number, reps: number): OneRepMax | null {
  if (!Number.isInteger(reps) || reps < 1) return null;
  const value = reps === 1 ? weight : epley(weight, reps);
  return value === null || value <= 0 ? null : { value, rough: isLowAccuracy(reps) };
}

/** Epley solved for weight: what you could lift for `reps` with this max. */
export function weightForReps(oneRepMax: number, reps: number): number {
  return reps === 1 ? oneRepMax : oneRepMax / (1 + reps / 30);
}

export function repTable(oneRepMax: number): { reps: number; weight: number; percent: number }[] {
  return TABLE_REPS.map((reps) => {
    const weight = weightForReps(oneRepMax, reps);
    return { reps, weight, percent: Math.round((weight / oneRepMax) * 100) };
  });
}
