import { useQuery } from '@tanstack/react-query';

import type { HistoryRepo, PreviousSet, WorkoutSummary } from './history';
import { sqliteHistoryRepo } from './sqliteHistory';

export const historyRepo: HistoryRepo = sqliteHistoryRepo;
export const PREVIOUS_SETS_KEY = 'previous-sets';
/** Every query over finished workouts starts with this key. */
export const HISTORY_QUERY_KEY = ['workout-history'] as const;

/** Last session's sets per exercise, read from the device (works offline). */
export function usePreviousSets(exerciseIds: string[]) {
  const ids = [...new Set(exerciseIds)].sort();
  return useQuery<Record<string, PreviousSet[]>>({
    queryKey: [PREVIOUS_SETS_KEY, ...ids],
    queryFn: () => historyRepo.previousSets(ids),
    staleTime: Infinity,
    networkMode: 'always',
  });
}

/** Every finished workout on the device, newest first (history list and calendar). */
export function useWorkoutHistory() {
  return useQuery<WorkoutSummary[]>({
    queryKey: [...HISTORY_QUERY_KEY, 'list'],
    queryFn: () => historyRepo.list(),
    staleTime: Infinity,
    networkMode: 'always',
  });
}

/** One finished workout with its sets and records; null if it isn't on the device. */
export function useSavedWorkout(id: string | undefined) {
  return useQuery({
    queryKey: [...HISTORY_QUERY_KEY, 'workout', id],
    queryFn: () => (id ? historyRepo.load(id) : null),
    staleTime: Infinity,
    networkMode: 'always',
  });
}
