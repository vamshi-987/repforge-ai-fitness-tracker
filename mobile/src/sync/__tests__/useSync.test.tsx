import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { HistoryRepo, SavedWorkout } from '@/workout/history';
import { makeSet, makeWorkoutExercise } from '@/test/workouts';

import type { OutboxItem, OutboxRepo } from '../outbox';
import { queueChange } from '../queue';
import {
  forgetSyncState,
  QUEUE_DEBOUNCE_MS,
  queueUnsyncedWorkouts,
  SYNC_INTERVAL_MS,
  syncEngine,
  useSyncEngine,
} from '../useSync';

jest.mock('@/workout/sqliteHistory', () => {
  const { createMemoryHistoryRepo } =
    jest.requireActual<typeof import('@/workout/history')>('@/workout/history');
  return { sqliteHistoryRepo: createMemoryHistoryRepo() };
});
jest.mock('@/routines/sqliteRepo', () => ({ sqliteRoutineRepo: {} }));
jest.mock('@/exercises/sqliteRepo', () => ({ sqliteLibraryRepo: {} }));

const history = jest.requireMock<{ sqliteHistoryRepo: HistoryRepo }>(
  '@/workout/sqliteHistory',
).sqliteHistoryRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;
const cursor = jest.requireMock<{ sqliteCursor: { value: number } }>(
  '@/sync/sqliteOutbox',
).sqliteCursor;

function workout(id: string): SavedWorkout {
  return {
    id,
    routineId: null,
    title: 'Before sync',
    notes: '',
    startedAt: 0,
    endedAt: 3_600_000,
    visibility: 'public',
    volumeKg: 0,
    setCount: 1,
    exercises: [makeWorkoutExercise({ sets: [makeSet({ completed: true })] })],
  };
}

beforeEach(async () => {
  await outbox.clear();
  await history.clear();
});

describe('backfill and sign-out', () => {
  it('queues workouts the server has never seen, once', async () => {
    await history.save(workout('old-1'), { muscleSets: {}, records: [] });
    await history.save(workout('old-2'), { muscleSets: {}, records: [] });

    await queueUnsyncedWorkouts();
    await queueUnsyncedWorkouts();

    expect(outbox.items.map((i) => [i.entityId, i.revision])).toEqual([
      ['old-1', 1],
      ['old-2', 1],
    ]);
  });

  it('forgets the queue, the cursor and the history', async () => {
    await history.save(workout('w'), { muscleSets: {}, records: [] });
    await queueUnsyncedWorkouts();
    cursor.value = 99;
    const cancel = jest.spyOn(syncEngine, 'cancel');

    await forgetSyncState();

    expect(cancel).toHaveBeenCalled();
    expect(outbox.items).toEqual([]);
    expect(cursor.value).toBe(0);
    expect(await history.load('w')).toBeNull();
  });
});

describe('useSyncEngine', () => {
  let sync: jest.SpyInstance;
  let appStateListener: (state: AppStateStatus) => void = () => undefined;
  let netListener: (state: Partial<NetInfoState>) => void = () => undefined;
  const removeAppState = jest.fn();
  const stopNetInfo = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    sync = jest.spyOn(syncEngine, 'sync').mockResolvedValue('synced');
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as (state: AppStateStatus) => void;
      return { remove: removeAppState };
    });
    jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
      netListener = listener as (state: Partial<NetInfoState>) => void;
      return stopNetInfo;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function mount() {
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { ...(await renderHook(() => useSyncEngine(), { wrapper })), invalidate };
  }

  it('syncs on launch, on foreground, after changes, when back online and on a timer', async () => {
    const { unmount } = await mount();
    await waitFor(() => expect(sync).toHaveBeenLastCalledWith({ force: true }));
    sync.mockClear();

    appStateListener('active');
    expect(sync).toHaveBeenLastCalledWith({ force: true });

    // Several quick changes, one push.
    await queueChange({
      entity: 'routine',
      entityId: 'a',
      op: 'delete',
      data: null,
      baseVersion: null,
    });
    await queueChange({
      entity: 'routine',
      entityId: 'b',
      op: 'delete',
      data: null,
      baseVersion: null,
    });
    sync.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(QUEUE_DEBOUNCE_MS);
    });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenLastCalledWith({ force: false });

    sync.mockClear();
    netListener({ isConnected: true, isInternetReachable: true });
    expect(sync).not.toHaveBeenCalled();
    netListener({ isConnected: false, isInternetReachable: false });
    netListener({ isConnected: true, isInternetReachable: true });
    expect(sync).toHaveBeenCalledWith({ force: true });

    sync.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(SYNC_INTERVAL_MS);
    });
    expect(sync).toHaveBeenCalledTimes(AppState.currentState === 'active' ? 1 : 0);

    await unmount();
    expect(removeAppState).toHaveBeenCalled();
    expect(stopNetInfo).toHaveBeenCalled();
  });

  it('refreshes the screens that show what a sync changed', async () => {
    const { invalidate } = await mount();
    await waitFor(() => expect(sync).toHaveBeenCalled());
    const changed = (
      syncEngine as unknown as {
        changedListeners: Set<(entities: Set<string>) => void>;
      }
    ).changedListeners;

    await act(async () => {
      changed.forEach((listener) => listener(new Set(['routine', 'workout'])));
    });

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['routines'],
      ['previous-sets'],
      ['workout-history'],
    ]);
  });
});
