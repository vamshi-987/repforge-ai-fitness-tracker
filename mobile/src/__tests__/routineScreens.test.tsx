import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import { session } from '@/auth/session';
import type { LibraryRepo } from '@/exercises/repo';
import { exercisePicker } from '@/exercises/picker';
import type { RoutineRepo } from '@/routines/repo';
import { resetRoutineSyncForTests } from '@/routines/store';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { errorResponse, fetchCalls, jsonResponse, makeMe, tokenPair } from '@/test/helpers';
import { BENCH, EQUIPMENT, EXERCISES, MUSCLES } from '@/test/library';
import { makeFolder, makeRoutine, makeRoutineExercise } from '@/test/routines';

import WorkoutScreen from '../../app/(tabs)/workout/index';
import ExercisePickerScreen from '../../app/exercise-picker';
import RoutineDetailScreen from '../../app/routine/[id]';
import RoutineEditScreen from '../../app/routine/edit';

jest.mock('@/routines/sqliteRepo', () => {
  const { createMemoryRoutineRepo } =
    jest.requireActual<typeof import('@/routines/repo')>('@/routines/repo');
  return { sqliteRoutineRepo: createMemoryRoutineRepo() };
});
jest.mock('@/exercises/sqliteRepo', () => {
  const { createMemoryRepo } =
    jest.requireActual<typeof import('@/exercises/repo')>('@/exercises/repo');
  return { sqliteLibraryRepo: createMemoryRepo() };
});
jest.mock('@/workout/sqliteStorage', () => {
  const { createMemoryWorkoutStorage } =
    jest.requireActual<typeof import('@/workout/storage')>('@/workout/storage');
  return { sqliteWorkoutStorage: createMemoryWorkoutStorage() };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
}));

const repo = jest.requireMock<{ sqliteRoutineRepo: RoutineRepo }>(
  '@/routines/sqliteRepo',
).sqliteRoutineRepo;
const library = jest.requireMock<{ sqliteLibraryRepo: LibraryRepo }>(
  '@/exercises/sqliteRepo',
).sqliteLibraryRepo;
const expoRouter = jest.requireMock<{
  useLocalSearchParams: jest.Mock;
  router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
}>('expo-router');

const UPPER = makeFolder({ name: 'Upper', position: 0 });
const PUSH = makeRoutine({ name: 'Push', folder_id: UPPER.id, position: 0 });
const PULL = makeRoutine({
  name: 'Pull',
  folder_id: UPPER.id,
  position: 1,
  exercises: [
    makeRoutineExercise({
      exercise_name: 'Lat Pulldown (Cable)',
      superset_group: 1,
      rest_seconds: 60,
    }),
    makeRoutineExercise({ exercise_name: 'Bicep Curl (Dumbbell)', superset_group: 1 }),
  ],
});
const LEGS = makeRoutine({ name: 'Legs', position: 0 });

function offline() {
  const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  globalThis.fetch = fetchMock;
  return fetchMock;
}

/** Answer GET /routines and /routine-folders from the local fixtures; route the rest. */
function server(handler: (method: string, url: string, body: unknown) => Response | undefined) {
  const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(init.body as string) as unknown) : null;
    const handled = handler(method, url, body);
    if (handled) return handled;
    if (url.endsWith('/v1/routines'))
      return jsonResponse(200, { items: [PUSH, PULL, LEGS], routine_limit: 4 });
    if (url.endsWith('/v1/routine-folders')) return jsonResponse(200, [UPPER]);
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found', details: null } });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
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
  resetRoutineSyncForTests();
  await session.start(tokenPair('a'));
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  await repo.replaceAll({ routines: [PUSH, PULL, LEGS], folders: [UPPER], limit: 4 });
  await library.replaceMuscles(MUSCLES);
  await library.replaceEquipment(EQUIPMENT);
  await library.replaceExercises(EXERCISES);
  expoRouter.useLocalSearchParams.mockReturnValue({});
});

describe('Workout tab', () => {
  it('lists routines by folder, offline, with the free-plan count', async () => {
    offline();
    await show(<WorkoutScreen />);

    expect(await screen.findByLabelText('Push')).toBeOnTheScreen();
    expect(screen.getByLabelText('Legs')).toBeOnTheScreen();
    expect(screen.getByText('Upper')).toBeOnTheScreen();
    expect(screen.getByText('3 of 4 routines on the free plan')).toBeOnTheScreen();
    expect(screen.getByText('Lat Pulldown (Cable), Bicep Curl (Dumbbell)')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Push'));
    expect(expoRouter.router.push).toHaveBeenCalledWith({
      pathname: '/routine/[id]',
      params: { id: PUSH.id },
    });
  });

  it('blocks a new routine at the free limit', async () => {
    await repo.replaceAll({
      routines: [PUSH, PULL, LEGS, makeRoutine({ name: 'Arms', position: 1 })],
      folders: [UPPER],
      limit: 4,
    });
    offline();
    await show(<WorkoutScreen />);

    expect(await screen.findByText(/Delete one or upgrade to Pro/)).toBeOnTheScreen();
    expect(screen.getByLabelText('New routine')).toBeDisabled();
  });

  it('creates a folder', async () => {
    const created = makeFolder({ name: 'Legs day', position: 1 });
    const fetchMock = server((method, url) =>
      method === 'POST' && url.endsWith('/routine-folders')
        ? jsonResponse(201, created)
        : undefined,
    );
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('New folder'));
    await fireEvent.changeText(screen.getByLabelText('Folder name'), ' Legs day ');
    await fireEvent.press(screen.getByLabelText('Create'));

    expect(await screen.findByText('Legs day')).toBeOnTheScreen();
    const post = fetchCalls(fetchMock).find((c) => c.init.method === 'POST');
    expect(JSON.parse(post?.init.body as string)).toEqual({ name: 'Legs day' });
  });

  it('reorders routines inside a folder', async () => {
    const fetchMock = server((method, url) =>
      method === 'POST' && url.endsWith('/routines/reorder')
        ? jsonResponse(200, {
            items: [{ ...PULL, position: 0 }, { ...PUSH, position: 1 }, LEGS],
            routine_limit: 4,
          })
        : undefined,
    );
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Reorder routines'));
    expect(screen.getByLabelText('Move Push up')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Move Push down'));

    await waitFor(() =>
      expect(fetchCalls(fetchMock).some((c) => c.url.endsWith('/routines/reorder'))).toBe(true),
    );
    const call = fetchCalls(fetchMock).find((c) => c.url.endsWith('/routines/reorder'));
    expect(JSON.parse(call?.init.body as string)).toEqual({
      folder_id: UPPER.id,
      routine_ids: [PULL.id, PUSH.id],
    });
    await waitFor(async () =>
      expect((await repo.load()).routines.find((r) => r.id === PULL.id)?.position).toBe(0),
    );
  });

  it('deletes a folder from its menu', async () => {
    const fetchMock = server((method) =>
      method === 'DELETE' ? jsonResponse(204, null) : undefined,
    );
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Folder options: Upper'));
    await fireEvent.press(screen.getByLabelText('Delete folder'));

    await waitFor(() =>
      expect(fetchCalls(fetchMock).some((c) => c.init.method === 'DELETE')).toBe(true),
    );
    expect(fetchCalls(fetchMock).find((c) => c.init.method === 'DELETE')?.url).toBe(
      `http://api.test/v1/routine-folders/${UPPER.id}`,
    );
  });

  it('explains an offline change', async () => {
    offline();
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Folder options: Upper'));
    await fireEvent.press(screen.getByLabelText('Move folder down'));
    await fireEvent.press(screen.getByLabelText('Folder options: Upper'));
    await fireEvent.press(screen.getByLabelText('Delete folder'));

    expect(await screen.findByText(/You're offline/)).toBeOnTheScreen();
  });
});

describe('Starting workouts', () => {
  beforeEach(() => useActiveWorkout.setState({ workout: null }));

  it('starts a routine from its card, offline', async () => {
    offline();
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Start Pull'));

    expect(useActiveWorkout.getState().workout).toMatchObject({
      routineId: PULL.id,
      title: 'Pull',
    });
    expect(useActiveWorkout.getState().workout?.exercises.map((e) => e.supersetGroup)).toEqual([
      1, 1,
    ]);
    expect(expoRouter.router.push).toHaveBeenCalledWith('/workout/active');
  });

  it('starts an empty workout and a routine from its screen', async () => {
    offline();
    await show(<WorkoutScreen />);
    await fireEvent.press(await screen.findByLabelText('Start empty workout'));
    expect(useActiveWorkout.getState().workout?.exercises).toEqual([]);

    useActiveWorkout.setState({ workout: null });
    expoRouter.useLocalSearchParams.mockReturnValue({ id: LEGS.id });
    await show(<RoutineDetailScreen />);
    await fireEvent.press(await screen.findByLabelText('Start routine'));
    expect(useActiveWorkout.getState().workout?.title).toBe('Legs');
  });
});

describe('Routine detail', () => {
  it('shows each exercise with its sets, reps and rest', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: PULL.id });
    await show(<RoutineDetailScreen />);

    expect(await screen.findByText('2 exercises · Upper')).toBeOnTheScreen();
    expect(screen.getByText('Superset 1 · 3 sets · 8–12 reps · Rest 1:00')).toBeOnTheScreen();
    expect(screen.getByText('Superset 1 · 3 sets · 8–12 reps · Rest 1:30')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Edit routine'));
    expect(expoRouter.router.push).toHaveBeenCalledWith({
      pathname: '/routine/edit',
      params: { id: PULL.id },
    });
  });

  it('moves the routine out of its folder', async () => {
    const fetchMock = server((method, _url, body) =>
      method === 'PATCH'
        ? jsonResponse(200, {
            ...PUSH,
            folder_id: (body as { folder_id: null }).folder_id,
            version: 2,
          })
        : undefined,
    );
    expoRouter.useLocalSearchParams.mockReturnValue({ id: PUSH.id });
    await show(<RoutineDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Move to folder'));
    await fireEvent.press(screen.getByLabelText('No folder'));

    await waitFor(async () =>
      expect((await repo.load()).routines.find((r) => r.id === PUSH.id)?.folder_id).toBeNull(),
    );
    const patch = fetchCalls(fetchMock).find((c) => c.init.method === 'PATCH');
    expect(JSON.parse(patch?.init.body as string)).toEqual({ folder_id: null });
  });

  it('deletes after confirming', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const fetchMock = server((method) =>
      method === 'DELETE' ? jsonResponse(204, null) : undefined,
    );
    expoRouter.useLocalSearchParams.mockReturnValue({ id: LEGS.id });
    await show(<RoutineDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Delete routine'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    expect(fetchCalls(fetchMock).find((c) => c.init.method === 'DELETE')?.url).toBe(
      `http://api.test/v1/routines/${LEGS.id}`,
    );
    expect((await repo.load()).routines.some((r) => r.id === LEGS.id)).toBe(false);
  });

  it('opens the copy after duplicating', async () => {
    const copy = makeRoutine({ name: 'Legs (Copy)', position: 1 });
    server((method, url) =>
      method === 'POST' && url.endsWith('/duplicate') ? jsonResponse(201, copy) : undefined,
    );
    expoRouter.useLocalSearchParams.mockReturnValue({ id: LEGS.id });
    await show(<RoutineDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Duplicate'));

    await waitFor(() =>
      expect(expoRouter.router.replace).toHaveBeenCalledWith({
        pathname: '/routine/[id]',
        params: { id: copy.id },
      }),
    );
  });

  it('explains when the routine is not on the device', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'gone' });
    await show(<RoutineDetailScreen />);

    expect(await screen.findByText(/isn't on this device/)).toBeOnTheScreen();
  });
});

describe('Routine editor', () => {
  it('builds a new routine from picked exercises', async () => {
    const created = makeRoutine({ name: 'Chest day', id: 'r-new' });
    const fetchMock = server((method, url) =>
      method === 'POST' && url.endsWith('/routines') ? jsonResponse(201, created) : undefined,
    );
    await show(<RoutineEditScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Routine name'), 'Chest day');
    await fireEvent.press(screen.getByLabelText('Add exercises'));
    expect(expoRouter.router.push).toHaveBeenCalledWith('/exercise-picker');
    exercisePicker.deliver([BENCH]);

    await fireEvent.changeText(
      await screen.findByLabelText('Bench Press (Barbell) set 1 weight'),
      '60',
    );
    await fireEvent.changeText(screen.getByLabelText('Bench Press (Barbell) set 1 reps'), '8');
    await fireEvent.press(screen.getByLabelText('Add set'));
    await fireEvent.press(screen.getByLabelText('Increase Bench Press (Barbell) rest'));
    await fireEvent.press(screen.getByLabelText('Bench Press (Barbell) set 1 type: Normal'));
    await fireEvent.press(screen.getByLabelText('Warm-up'));
    await fireEvent.press(screen.getByLabelText('Save routine'));

    await waitFor(() =>
      expect(expoRouter.router.replace).toHaveBeenCalledWith({
        pathname: '/routine/[id]',
        params: { id: 'r-new' },
      }),
    );
    const post = fetchCalls(fetchMock).find((c) => c.init.method === 'POST');
    expect(JSON.parse(post?.init.body as string)).toEqual({
      name: 'Chest day',
      notes: '',
      folder_id: null,
      exercises: [
        {
          exercise_id: BENCH.id,
          superset_group: null,
          rest_seconds: 105,
          rep_range_min: null,
          rep_range_max: null,
          notes: '',
          sets: [
            { set_type: 'warmup', target_weight_kg: 60, target_reps: 8, target_duration_s: null },
            { set_type: 'normal', target_weight_kg: 60, target_reps: 8, target_duration_s: null },
          ],
        },
      ],
    });
    expect((await repo.load()).routines.some((r) => r.id === 'r-new')).toBe(true);
  });

  it('shows problems before sending anything', async () => {
    const fetchMock = offline();
    await show(<RoutineEditScreen />);

    await fireEvent.press(await screen.findByLabelText('Save routine'));

    expect(screen.getByText('Give the routine a name')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains the free-plan limit', async () => {
    server((method) =>
      method === 'POST' ? errorResponse(403, 'routine_limit_reached', { limit: 4 }) : undefined,
    );
    await show(<RoutineEditScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Routine name'), 'Fifth');
    await fireEvent.press(screen.getByLabelText('Save routine'));

    expect(await screen.findByText(/Free accounts can keep 4 routines/)).toBeOnTheScreen();
  });

  it('edits an existing routine in place', async () => {
    const fetchMock = server((method, _url, body) =>
      method === 'PATCH'
        ? jsonResponse(200, { ...PULL, name: (body as { name: string }).name, version: 2 })
        : undefined,
    );
    expoRouter.useLocalSearchParams.mockReturnValue({ id: PULL.id });
    await show(<RoutineEditScreen />);

    expect(await screen.findByDisplayValue('Pull')).toBeOnTheScreen();
    expect(screen.getAllByText('⛓ Superset · tap to unlink')).toHaveLength(1);
    await fireEvent.changeText(screen.getByLabelText('Routine name'), 'Pull A');
    await fireEvent.press(screen.getByLabelText('Unlink Lat Pulldown (Cable) from superset'));
    await fireEvent.press(screen.getByLabelText('Save routine'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    const patch = fetchCalls(fetchMock).find((c) => c.init.method === 'PATCH');
    const sent = JSON.parse(patch?.init.body as string) as {
      name: string;
      folder_id: string;
      exercises: { superset_group: number | null; rest_seconds: number | null }[];
    };
    expect(sent.name).toBe('Pull A');
    expect(sent.folder_id).toBe(UPPER.id);
    expect(sent.exercises.map((e) => [e.superset_group, e.rest_seconds])).toEqual([
      [null, 60],
      [null, null],
    ]);
  });
});

describe('Exercise picker', () => {
  it('hands back the picked exercises in tap order', async () => {
    offline();
    const onPick = jest.fn();
    exercisePicker.expect(onPick);
    await show(<ExercisePickerScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Search exercises'), 'bench');
    await fireEvent.press(screen.getByLabelText('Close-Grip Bench Press (Barbell)'));
    await fireEvent.press(screen.getByLabelText('Bench Press (Barbell)'));
    await fireEvent.press(screen.getByLabelText('Add 2 exercises'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].map((e: { name: string }) => e.name)).toEqual([
      'Close-Grip Bench Press (Barbell)',
      'Bench Press (Barbell)',
    ]);
    expect(expoRouter.router.back).toHaveBeenCalled();
  });
});
