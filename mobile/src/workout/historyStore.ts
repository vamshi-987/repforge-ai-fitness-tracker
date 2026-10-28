import { useQuery } from '@tanstack/react-query';

import type { HistoryRepo, PreviousSet } from './history';
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
