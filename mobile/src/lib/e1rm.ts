/**
 * Estimated one-rep max (Epley): weight × (1 + reps / 30). The backend's overload coach uses
 * the same formula (CLAUDE.md §10).
 */
export function epley(weightKg: number, reps: number): number | null {
  if (weightKg <= 0 || reps <= 0) return null;
  return weightKg * (1 + reps / 30);
}

/** Above 12 reps the estimate drifts too far to trust; charts flag such points. */
export const E1RM_MAX_ACCURATE_REPS = 12;

export function isLowAccuracy(reps: number): boolean {
  return reps > E1RM_MAX_ACCURATE_REPS;
}
