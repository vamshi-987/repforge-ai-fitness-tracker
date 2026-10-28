import type { Exercise } from '@/api/types';
import { workoutChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import type { HistoryRepo, SavedWorkout } from './history';
import { historyRepo } from './historyStore';
import { detectRecords, muscleSets, personalRecords, type PersonalRecord } from './records';

/**
 * Store a finished workout with its muscle sets and new records, in one transaction, and
 * queue it for the server. The server's answer (its set ids, totals and records) replaces
 * the local copy when sync runs; until then it stays `synced_at = null`.
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
  await queueChange(workoutChange(workout));
  return personalRecords(records, workout.exercises);
}
