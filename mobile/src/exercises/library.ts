import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import type { LibraryRepo, LocalLibrary } from './repo';
import { sqliteLibraryRepo } from './sqliteRepo';
import { ETAG_KEYS, syncLibrary } from './sync';

export const libraryRepo: LibraryRepo = sqliteLibraryRepo;
export const LIBRARY_QUERY_KEY = ['exercise-library'] as const;

let inflight: Promise<boolean> | null = null;

/** Sync with the server; concurrent callers share one run. Resolves true if rows changed. */
export function refreshLibrary(): Promise<boolean> {
  inflight ??= syncLibrary(libraryRepo).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** On sign-out: the next account must never see this one's custom exercises. */
export async function forgetUserExercises(): Promise<void> {
  await libraryRepo.removeCustomExercises();
  // The stored ETag described this user's list; force a full download for the next one.
  await libraryRepo.setMeta(ETAG_KEYS.exercises, null);
}

/** The local library. Reads SQLite, so it works offline (`networkMode: 'always'`). */
export function useLibrary() {
  return useQuery<LocalLibrary>({
    queryKey: LIBRARY_QUERY_KEY,
    queryFn: () => libraryRepo.load(),
    staleTime: Infinity,
    networkMode: 'always',
  });
}

export type SyncStatus = 'syncing' | 'done' | 'failed';

/** Refresh the local library from the server once on mount; `retry` runs it again. */
export function useLibrarySync(): { status: SyncStatus; retry: () => void } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SyncStatus>('syncing');

  const sync = useCallback(
    () =>
      refreshLibrary()
        .then(async (changed) => {
          if (changed) await queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
          setStatus('done');
        })
        .catch(() => setStatus('failed')),
    [queryClient],
  );

  useEffect(() => {
    void sync();
  }, [sync]);

  const retry = useCallback(() => {
    setStatus('syncing');
    void sync();
  }, [sync]);

  return { status, retry };
}

/** Test hook: forget a sync left in flight by a previous test. */
export function resetLibrarySyncForTests(): void {
  inflight = null;
}
