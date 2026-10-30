import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert, AppState } from 'react-native';

import * as syncApi from '@/api/sync';
import type { SyncEntity } from '@/api/types';
import { LIBRARY_QUERY_KEY, libraryRepo } from '@/exercises/library';
import { EXERCISE_STATS_KEY } from '@/exercises/stats';
import { ROUTINES_QUERY_KEY, routineRepo } from '@/routines/store';
import { STATS_KEY } from '@/stats/dashboard';
import { HISTORY_QUERY_KEY, historyRepo, PREVIOUS_SETS_KEY } from '@/workout/historyStore';

import { workoutChange } from './changes';
import { SyncEngine, type SyncNotice } from './engine';
import { createLocalStore } from './local';
import { outboxKey } from './outbox';
import { onQueued, outbox, queueChange } from './queue';
import { sqliteCursor } from './sqliteOutbox';

/** While the app is open, sync at least this often. */
export const SYNC_INTERVAL_MS = 5 * 60_000;
/** Several quick edits go out in one push. */
export const QUEUE_DEBOUNCE_MS = 500;

export const syncEngine = new SyncEngine({
  outbox,
  api: { push: syncApi.pushChanges, pull: syncApi.pullChanges },
  local: createLocalStore({ library: libraryRepo, routines: routineRepo, history: historyRepo }),
  cursor: sqliteCursor,
});

/** The cached queries that read each entity's rows. */
export const ENTITY_QUERIES: Record<SyncEntity, readonly (readonly unknown[])[]> = {
  exercise: [LIBRARY_QUERY_KEY],
  routine_folder: [ROUTINES_QUERY_KEY],
  routine: [ROUTINES_QUERY_KEY],
  workout: [[PREVIOUS_SETS_KEY], HISTORY_QUERY_KEY, [EXERCISE_STATS_KEY], [STATS_KEY]],
};

/** Workouts finished before sync existed (or whose queue entry was lost) go out too. */
export async function queueUnsyncedWorkouts(): Promise<void> {
  const pending = await outbox.pendingKeys();
  for (const workout of await historyRepo.unsynced()) {
    if (!pending.has(outboxKey('workout', workout.id))) await queueChange(workoutChange(workout));
  }
}

/** On sign-out: drop the queue, the cursor and the workout history of this account. */
export async function forgetSyncState(): Promise<void> {
  syncEngine.cancel();
  await outbox.clear();
  await sqliteCursor.clear();
  await historyRepo.clear();
}

function showNotices(notices: SyncNotice[]): void {
  const messages = [...new Set(notices.map((n) => n.message))].slice(0, 3);
  Alert.alert(
    notices.length === 1 ? "A change wasn't saved" : "Some changes weren't saved",
    messages.join('\n'),
  );
}

/**
 * Keep the device and the server in step while signed in: sync on launch, when the app
 * comes to the foreground, when the network comes back, shortly after every local change,
 * and every few minutes while open.
 */
export function useSyncEngine(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const run = (force = false) => void syncEngine.sync({ force });
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => run(), QUEUE_DEBOUNCE_MS);
    };

    const stopChanged = syncEngine.onChanged((entities) => {
      const keys = new Set([...entities].flatMap((entity) => ENTITY_QUERIES[entity]));
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    });
    const stopNotices = syncEngine.onNotice(showNotices);
    const stopQueue = onQueued(soon);
    let online: boolean | null = null;
    const stopNetInfo = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      // Back online: send what queued up, without waiting out the backoff.
      if (connected && online === false) run(true);
      online = connected;
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') run(true);
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') run();
    }, SYNC_INTERVAL_MS);

    void queueUnsyncedWorkouts()
      .catch(() => undefined)
      .finally(() => run(true));

    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(interval);
      appState.remove();
      stopNetInfo();
      stopQueue();
      stopNotices();
      stopChanged();
    };
  }, [queryClient]);
}
