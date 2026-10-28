import type { Exercise } from '@/api/types';
import { deletion, workoutChange } from '@/sync/changes';
import { queueChange } from '@/sync/queue';

import type { HistoryRepo, SavedWorkout } from './history';
import { historyRepo } from './historyStore';
import { detectRecords, muscleSets, personalRecords, type PersonalRecord } from './records';

type MuscleInfo = Pick<Exercise, 'id' | 'primary_muscle' | 'secondary_muscles'>;

/**
 * Store a finished workout with its muscle sets and new records, in one transaction, and
 * queue it for the server. The server's answer (its set ids, totals and records) replaces
 * the local copy when sync runs; until then it stays `synced_at = null`.
 * Saving the same workout twice (the app was killed right after saving, and the workout was
 * resumed) returns the first result instead of failing.
 */
export async function saveFinishedWorkout(
  workout: SavedWorkout,
  library: MuscleInfo[],
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

/**
 * Save an edit of a finished workout (within the 24-hour window). Its records are worked out
 * again against the other workouts' bests; the server recomputes everything when it gets the
 * edit, and its answer replaces this copy. The edit is queued from the server version it
 * started from, so another device's change in between is noticed.
 */
export async function updateSavedWorkout(
  workout: SavedWorkout,
  library: MuscleInfo[],
  repo: HistoryRepo = historyRepo,
): Promise<void> {
  const info = await repo.syncInfo(workout.id);
  const previous = await repo.bestRecords(
    workout.exercises.map((e) => e.exerciseId),
    workout.id,
  );
  const records = detectRecords(workout.exercises, previous, workout.id, workout.endedAt);
  await repo.replace(workout, { muscleSets: muscleSets(workout.exercises, library), records });
  await queueChange(workoutChange(workout, info?.version ?? 0));
}

/** Delete from the device now, and from the server when sync runs. Allowed at any age. */
export async function deleteSavedWorkout(
  workoutId: string,
  repo: HistoryRepo = historyRepo,
): Promise<void> {
  await repo.remove(workoutId);
  await queueChange(deletion('workout', workoutId));
}
