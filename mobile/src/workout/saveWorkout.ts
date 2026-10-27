import type { Exercise } from '@/api/types';

import type { HistoryRepo, SavedWorkout } from './history';
import { historyRepo } from './historyStore';
import { detectRecords, muscleSets, personalRecords, type PersonalRecord } from './records';

/**
 * Store a finished workout with its muscle sets and new records, in one transaction.
 * Phase 4's sync engine pushes it to the server (it stays `synced_at = null` until then).
 * Saving the same workout twice (the app was killed right after saving, and the workout was
 * resumed) returns the first result instead of failing.
 */
export async function saveFinishedWorkout(
  workout: SavedWorkout,
  library: Pick<Exercise, 'id' | 'primary_muscle' | 'secondary_muscles'>[],
  repo: HistoryRepo = historyRepo,
): Promise<PersonalRecord[]> {
  const existing = await repo.load(workout.id);
  if (existing) return personalRecords(existing.records, existing.exercises);
  const previous = await repo.bestRecords(workout.exercises.map((e) => e.exerciseId));
  const records = detectRecords(workout.exercises, previous, workout.id, workout.endedAt);
  await repo.save(workout, { muscleSets: muscleSets(workout.exercises, library), records });
  return personalRecords(records, workout.exercises);
}
