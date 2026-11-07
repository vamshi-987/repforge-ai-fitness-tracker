import { useQuery } from '@tanstack/react-query';

import * as coachApi from '@/api/coach';

export const WEEKLY_REPORT_KEY = ['weekly-report'] as const;

/** Written on the server, so it needs a connection. */
export function useWeeklyReport() {
  return useQuery({
    queryKey: WEEKLY_REPORT_KEY,
    queryFn: () => coachApi.getWeeklyReport(),
    retry: false,
    staleTime: 60_000,
    networkMode: 'always',
  });
}

/**
 * Today's targets for a routine's exercises. Nice to have: free accounts and offline starts
 * just see no suggestions.
 */
export function useRoutineOverload(routineId: string | null) {
  return useQuery({
    queryKey: ['overload', routineId],
    queryFn: async () => (await coachApi.getRoutineOverload(routineId ?? '')).items,
    enabled: routineId !== null,
    retry: false,
    staleTime: 5 * 60_000,
    networkMode: 'always',
  });
}
