import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import { session } from '@/auth/session';
import { resetLibrarySyncForTests } from '@/exercises/library';
import type { LibraryRepo } from '@/exercises/repo';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { BENCH, EQUIPMENT, EXERCISES, MUSCLES, makeExercise } from '@/test/library';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { jsonResponse, makeMe, tokenPair } from '@/test/helpers';

import ExerciseDetailScreen from '../../app/exercise/[id]';
import ExerciseFormScreen from '../../app/exercise/form';
import ExerciseLibraryScreen from '../../app/exercises/index';

jest.mock('@/exercises/sqliteRepo', () => {
  const { createMemoryRepo } =
    jest.requireActual<typeof import('@/exercises/repo')>('@/exercises/repo');
  return { sqliteLibraryRepo: createMemoryRepo() };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: () => null }));

const repo = jest.requireMock<{ sqliteLibraryRepo: LibraryRepo }>(
  '@/exercises/sqliteRepo',
).sqliteLibraryRepo;
const expoRouter = jest.requireMock<{
  useLocalSearchParams: jest.Mock;
  router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
}>('expo-router');

const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

const MINE = makeExercise({ id: 'mine-1', name: 'My Landmine Press', is_custom: true });

function offline() {
  const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  globalThis.fetch = fetchMock;
  return fetchMock;
}

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuthStoreForTests();
  resetLibrarySyncForTests();
  await session.start(tokenPair('a'));
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  await repo.replaceMuscles(MUSCLES);
  await repo.replaceEquipment(EQUIPMENT);
  await repo.replaceExercises([...EXERCISES, MINE]);
  for (const key of ['etag:muscles', 'etag:equipment', 'etag:exercises'])
    await repo.setMeta(key, null);
  expoRouter.useLocalSearchParams.mockReturnValue({});
  await outbox.clear();
});

describe('Exercise library', () => {
  it('searches "bench" offline from the device copy', async () => {
    offline();
    await show(<ExerciseLibraryScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Search exercises'), 'bench');

    expect(screen.getByLabelText('Bench Press (Barbell)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Bench Press (Dumbbell)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Close-Grip Bench Press (Barbell)')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Squat (Barbell)')).toBeNull();
    expect(screen.queryByLabelText('Retired Bench Thing')).toBeNull();
  });

  it('filters by muscle and equipment and opens an exercise', async () => {
    offline();
    await show(<ExerciseLibraryScreen />);

    await fireEvent.press(await screen.findByLabelText('Muscle: Chest'));
    await fireEvent.press(screen.getByLabelText('Equipment: Barbell'));

    expect(screen.getByLabelText('Bench Press (Barbell)')).toBeOnTheScreen();
    expect(screen.getByLabelText('My Landmine Press')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Bench Press (Dumbbell)')).toBeNull();
    expect(screen.getByText('Custom')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Bench Press (Barbell)'));
    expect(expoRouter.router.push).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: BENCH.id },
    });
  });

  it('says how to get the library when the device has none and is offline', async () => {
    await repo.replaceExercises([]);
    const fetchMock = offline();
    await show(<ExerciseLibraryScreen />);

    expect(
      await screen.findByText('Connect to the internet once to download the exercise library.'),
    ).toBeOnTheScreen();
    fetchMock.mockResolvedValue(jsonResponse(304, null));
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
  });

  it('downloads the library when online', async () => {
    await repo.replaceExercises([]);
    globalThis.fetch = jest.fn(async (url: string) => {
      if (url.includes('/muscles')) return jsonResponse(200, MUSCLES, { ETag: 'W/"m"' });
      if (url.includes('/equipment')) return jsonResponse(200, EQUIPMENT, { ETag: 'W/"e"' });
      return jsonResponse(200, { items: [BENCH], next_cursor: null }, { ETag: 'W/"x"' });
    }) as unknown as typeof fetch;
    await show(<ExerciseLibraryScreen />);

    expect(await screen.findByLabelText('Bench Press (Barbell)')).toBeOnTheScreen();
    expect(await repo.getMeta('etag:exercises')).toBe('W/"x"');
  });
});

describe('Exercise detail', () => {
  it('shows a library exercise with its red body map and instructions', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: BENCH.id });
    await show(<ExerciseDetailScreen />);

    expect(await screen.findByText('Barbell · Weight & reps')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Primary: Chest. Secondary: Front Delts, Triceps.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Lower the bar to your chest.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Edit')).toBeNull();
    expect(screen.queryByLabelText('Delete')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Section: History'));
    expect(screen.getByText(/appear here once you log workouts/)).toBeOnTheScreen();
  });

  it('duplicates into a custom exercise and opens it for editing, offline', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: BENCH.id });
    await show(<ExerciseDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Duplicate as custom'));

    await waitFor(() => expect(expoRouter.router.replace).toHaveBeenCalled());
    const copy = (await repo.load()).exercises.find(
      (e) => e.name === 'Bench Press (Barbell) (Copy)',
    );
    expect(copy).toMatchObject({ is_custom: true, type: BENCH.type, version: 0 });
    expect(expoRouter.router.replace).toHaveBeenCalledWith({
      pathname: '/exercise/form',
      params: { id: copy?.id },
    });
    expect(outbox.items).toEqual([
      expect.objectContaining({ entity: 'exercise', entityId: copy?.id, op: 'upsert' }),
    ]);
  });

  it('deletes a custom exercise after confirming, offline', async () => {
    offline();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    expoRouter.useLocalSearchParams.mockReturnValue({ id: MINE.id });
    await show(<ExerciseDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Delete'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    expect((await repo.load()).exercises.some((e) => e.id === MINE.id)).toBe(false);
    expect(outbox.items).toEqual([
      expect.objectContaining({ entity: 'exercise', entityId: MINE.id, op: 'delete' }),
    ]);
  });

  it('explains when an exercise is not on the device', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'gone' });
    await show(<ExerciseDetailScreen />);

    expect(await screen.findByText(/isn't on this device/)).toBeOnTheScreen();
  });
});

describe('Custom exercise form', () => {
  it('shows what is missing before sending anything', async () => {
    const fetchMock = offline();
    await show(<ExerciseFormScreen />);

    await fireEvent.press(await screen.findByLabelText('Create exercise'));

    expect(screen.getByText('Give the exercise a name.')).toBeOnTheScreen();
    expect(screen.getByText('Choose the main muscle worked.')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates an exercise offline, opens it and queues it for the server', async () => {
    const fetchMock = offline();
    await show(<ExerciseFormScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Name'), ' Cable  Thing ');
    await fireEvent.press(screen.getByLabelText('Weight & reps'));
    await fireEvent.press(screen.getByLabelText('Equipment: Cable'));
    await fireEvent.press(screen.getByLabelText('Primary muscle: Chest'));
    await fireEvent.press(screen.getByLabelText('Secondary muscle: Triceps'));
    await fireEvent.press(screen.getByLabelText('Create exercise'));

    await waitFor(() => expect(expoRouter.router.replace).toHaveBeenCalled());
    const created = (await repo.load()).exercises.find((e) => e.name === 'Cable Thing');
    expect(created).toMatchObject({ is_custom: true, equipment: 'cable', version: 0 });
    expect(expoRouter.router.replace).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: created?.id },
    });
    expect(outbox.items).toEqual([
      expect.objectContaining({
        entity: 'exercise',
        entityId: created?.id,
        op: 'upsert',
        baseVersion: null,
        data: {
          name: 'Cable Thing',
          type: 'weight_reps',
          equipment: 'cable',
          primary_muscle: 'chest',
          secondary_muscles: ['triceps'],
          instructions: [],
        },
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('edits a custom exercise without offering a type change', async () => {
    offline();
    const synced = { ...MINE, version: 3 };
    await repo.putExercise(synced);
    expoRouter.useLocalSearchParams.mockReturnValue({ id: MINE.id });
    await show(<ExerciseFormScreen />);

    expect(await screen.findByText(/Can't change after saving/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Duration')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Renamed');
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    expect((await repo.load()).exercises.find((e) => e.id === MINE.id)?.name).toBe('Renamed');
    // The whole exercise is queued, based on the version the server last confirmed.
    expect(outbox.items).toEqual([
      expect.objectContaining({
        entityId: MINE.id,
        baseVersion: 3,
        data: expect.objectContaining({ name: 'Renamed', type: MINE.type }),
      }),
    ]);
  });

  it('refuses to edit a library exercise', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: BENCH.id });
    await show(<ExerciseFormScreen />);

    expect(await screen.findByText('Only your own exercises can be edited.')).toBeOnTheScreen();
  });
});
