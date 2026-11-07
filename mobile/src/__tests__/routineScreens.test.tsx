import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import { session } from '@/auth/session';
import type { LibraryRepo } from '@/exercises/repo';
import { exercisePicker } from '@/exercises/picker';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import type { RoutineRepo } from '@/routines/repo';
import { resetRoutineSyncForTests } from '@/routines/store';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { makeMe, tokenPair } from '@/test/helpers';
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

const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

/** The queued changes as [entity, id, op, data]. */
function queued() {
  return outbox.items.map((i) => [i.entity, i.entityId, i.op, i.data] as const);
}

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
  await outbox.clear();
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

  it('creates a folder, offline', async () => {
    offline();
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('New folder'));
    await fireEvent.changeText(screen.getByLabelText('Folder name'), ' Legs   day ');
    await fireEvent.press(screen.getByLabelText('Create'));

    expect(await screen.findByText('Legs day')).toBeOnTheScreen();
    const folder = (await repo.load()).folders.find((f) => f.name === 'Legs day');
    expect(folder).toMatchObject({ position: 1, version: 0 });
    expect(queued()).toEqual([
      ['routine_folder', folder?.id, 'upsert', { name: 'Legs day', position: 1 }],
    ]);
  });

  it('reorders routines inside a folder, offline', async () => {
    offline();
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Reorder routines'));
    expect(screen.getByLabelText('Move Push up')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Move Push down'));

    await waitFor(async () =>
      expect((await repo.load()).routines.find((r) => r.id === PULL.id)?.position).toBe(0),
    );
    expect((await repo.load()).routines.find((r) => r.id === PUSH.id)?.position).toBe(1);
    // Only the routines whose place changed are queued, each with its new position.
    expect(queued().map(([entity, id, , data]) => [entity, id, data?.position])).toEqual([
      ['routine', PULL.id, 0],
      ['routine', PUSH.id, 1],
    ]);
  });

  it('deletes a folder from its menu, keeping its routines', async () => {
    offline();
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Folder options: Upper'));
    await fireEvent.press(screen.getByLabelText('Delete folder'));

    await waitFor(async () => expect((await repo.load()).folders).toEqual([]));
    const routines = (await repo.load()).routines;
    // Moved after Legs, in their order; the server does the same when it deletes the folder.
    expect(routines.map((r) => [r.name, r.folder_id, r.position])).toEqual(
      expect.arrayContaining([
        ['Legs', null, 0],
        ['Push', null, 1],
        ['Pull', null, 2],
      ]),
    );
    expect(queued()).toEqual([['routine_folder', UPPER.id, 'delete', null]]);
  });

  it('reorders folders offline', async () => {
    offline();
    const LOWER = makeFolder({ name: 'Lower', position: 1 });
    await repo.putFolders([LOWER]);
    await show(<WorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Folder options: Upper'));
    await fireEvent.press(screen.getByLabelText('Move folder down'));

    await waitFor(() => expect(queued()).toHaveLength(2));
    expect(queued().map(([, id, , data]) => [id, data?.position])).toEqual([
      [LOWER.id, 0],
      [UPPER.id, 1],
    ]);
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
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: PUSH.id });
    await show(<RoutineDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Move to folder'));
    await fireEvent.press(screen.getByLabelText('No folder'));

    await waitFor(async () =>
      expect((await repo.load()).routines.find((r) => r.id === PUSH.id)?.folder_id).toBeNull(),
    );
    // Last among the routines without a folder, as the server would place it.
    expect((await repo.load()).routines.find((r) => r.id === PUSH.id)?.position).toBe(1);
    expect(outbox.items[0]).toMatchObject({ entityId: PUSH.id, baseVersion: PUSH.version });
    expect(queued()[0]?.[3]).toMatchObject({ folder_id: null, position: 1, name: 'Push' });
  });

  it('deletes after confirming', async () => {
    offline();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    expoRouter.useLocalSearchParams.mockReturnValue({ id: LEGS.id });
    await show(<RoutineDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Delete routine'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    expect((await repo.load()).routines.some((r) => r.id === LEGS.id)).toBe(false);
    expect(queued()).toEqual([['routine', LEGS.id, 'delete', null]]);
  });

  it('opens the copy after duplicating', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: LEGS.id });
    await show(<RoutineDetailScreen />);

    await fireEvent.press(await screen.findByLabelText('Duplicate'));

    await waitFor(() => expect(expoRouter.router.replace).toHaveBeenCalled());
    const copy = (await repo.load()).routines.find((r) => r.name === 'Legs (Copy)');
    expect(copy).toMatchObject({ position: 1, version: 0, exercises: LEGS.exercises });
    expect(expoRouter.router.replace).toHaveBeenCalledWith({
      pathname: '/routine/[id]',
      params: { id: copy?.id },
    });
    expect(outbox.items[0]).toMatchObject({ entityId: copy?.id, baseVersion: null });
  });

  it('explains when the routine is not on the device', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'gone' });
    await show(<RoutineDetailScreen />);

    expect(await screen.findByText(/isn't on this device/)).toBeOnTheScreen();
  });
});

describe('Routine editor', () => {
  it('builds a new routine from picked exercises, offline', async () => {
    offline();
    await show(<RoutineEditScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Routine name'), 'Chest day');
    await fireEvent.press(screen.getByLabelText('Add exercises'));
    expect(expoRouter.router.push).toHaveBeenCalledWith('/exercise-picker');
    await act(() => exercisePicker.deliver([BENCH]));

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

    await waitFor(() => expect(expoRouter.router.replace).toHaveBeenCalled());
    const created = (await repo.load()).routines.find((r) => r.name === 'Chest day');
    expect(expoRouter.router.replace).toHaveBeenCalledWith({
      pathname: '/routine/[id]',
      params: { id: created?.id },
    });
    expect(created?.exercises[0]).toMatchObject({
      exercise_name: BENCH.name,
      exercise_type: BENCH.type,
    });
    expect(queued()).toEqual([
      [
        'routine',
        created?.id,
        'upsert',
        {
          name: 'Chest day',
          notes: '',
          folder_id: null,
          // Last among the routines without a folder (Legs is at 0).
          position: 1,
          exercises: [
            {
              exercise_id: BENCH.id,
              superset_group: null,
              rest_seconds: 105,
              rep_range_min: null,
              rep_range_max: null,
              notes: '',
              sets: [
                {
                  set_type: 'warmup',
                  target_weight_kg: 60,
                  target_reps: 8,
                  target_duration_s: null,
                },
                {
                  set_type: 'normal',
                  target_weight_kg: 60,
                  target_reps: 8,
                  target_duration_s: null,
                },
              ],
            },
          ],
        },
      ],
    ]);
  });

  it('shows problems before sending anything', async () => {
    const fetchMock = offline();
    await show(<RoutineEditScreen />);

    await fireEvent.press(await screen.findByLabelText('Save routine'));

    expect(screen.getByText('Give the routine a name')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains the free-plan limit', async () => {
    offline();
    await repo.replaceAll({ routines: [PUSH, PULL, LEGS], folders: [UPPER], limit: 3 });
    await show(<RoutineEditScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Routine name'), 'Fourth');
    await fireEvent.press(screen.getByLabelText('Save routine'));

    expect(await screen.findByText(/Free accounts can keep 3 routines/)).toBeOnTheScreen();
    expect(outbox.items).toEqual([]);
  });

  it('edits an existing routine in place', async () => {
    offline();
    expoRouter.useLocalSearchParams.mockReturnValue({ id: PULL.id });
    await show(<RoutineEditScreen />);

    expect(await screen.findByDisplayValue('Pull')).toBeOnTheScreen();
    expect(screen.getAllByText('⛓ Superset · tap to unlink')).toHaveLength(1);
    await fireEvent.changeText(screen.getByLabelText('Routine name'), 'Pull A');
    await fireEvent.press(screen.getByLabelText('Unlink Lat Pulldown (Cable) from superset'));
    await fireEvent.press(screen.getByLabelText('Save routine'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    const saved = (await repo.load()).routines.find((r) => r.id === PULL.id);
    expect(saved).toMatchObject({ name: 'Pull A', folder_id: UPPER.id, position: 1, version: 1 });
    expect(outbox.items[0]).toMatchObject({ entityId: PULL.id, baseVersion: 1 });
    const sent = queued()[0]?.[3] as {
      exercises: { superset_group: number | null; rest_seconds: number | null }[];
    };
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
