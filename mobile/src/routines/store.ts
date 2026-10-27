import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import type { RoutineRepo, LocalRoutines } from './repo';
import { sqliteRoutineRepo } from './sqliteRepo';
import { syncRoutines } from './sync';

export const routineRepo: RoutineRepo = sqliteRoutineRepo;
export const ROUTINES_QUERY_KEY = ['routines'] as const;

let inflight: Promise<void> | null = null;

/** Pull the server's routines; concurrent callers share one request. */
export function refreshRoutines(): Promise<void> {
  inflight ??= syncRoutines(routineRepo).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** On sign-out: the next account must never see this one's routines. */
export function forgetRoutines(): Promise<void> {
  return routineRepo.clear();
}

/** The local routines. Reads SQLite, so it works offline (`networkMode: 'always'`). */
export function useRoutines() {
  return useQuery<LocalRoutines>({
    queryKey: ROUTINES_QUERY_KEY,
    queryFn: () => routineRepo.load(),
    staleTime: Infinity,
    networkMode: 'always',
  });
}

export type RoutineSyncStatus = 'syncing' | 'done' | 'failed';

/** Refresh the local routines from the server on mount; `refresh` runs it again. */
export function useRoutineSync(): { status: RoutineSyncStatus; refresh: () => Promise<void> } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RoutineSyncStatus>('syncing');

  const sync = useCallback(
    () =>
      refreshRoutines()
        .then(async () => {
          await queryClient.invalidateQueries({ queryKey: ROUTINES_QUERY_KEY });
          setStatus('done');
        })
        .catch(() => setStatus('failed')),
    [queryClient],
  );

  useEffect(() => {
    void sync();
  }, [sync]);

  const refresh = useCallback(() => {
    setStatus('syncing');
    return sync();
  }, [sync]);

  return { status, refresh };
}

/** Test hook: forget a sync left in flight by a previous test. */
export function resetRoutineSyncForTests(): void {
  inflight = null;
}
