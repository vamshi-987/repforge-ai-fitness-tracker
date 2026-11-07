import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import type { LibraryRepo } from '@/exercises/repo';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { useRestTimer } from '@/stores/timer';
import { makeMe } from '@/test/helpers';
import { BENCH, EQUIPMENT, EXERCISES, MUSCLES } from '@/test/library';
import { makeSet, makeWorkout, makeWorkoutExercise } from '@/test/workouts';
import { toSavedWorkout } from '@/workout/finish';
import type { HistoryRepo, SavedWorkout, WorkoutExtras } from '@/workout/history';
import { saveFinishedWorkout } from '@/workout/saveWorkout';
import type { ActiveWorkout } from '@/workout/types';

import ActiveWorkoutScreen from '../../app/(tabs)/workout/active';
import FinishWorkoutScreen from '../../app/(tabs)/workout/finish';
import WorkoutSummaryScreen from '../../app/(tabs)/workout/summary';

jest.mock('@/workout/sqliteStorage', () => {
  const { createMemoryWorkoutStorage } =
    jest.requireActual<typeof import('@/workout/storage')>('@/workout/storage');
  return { sqliteWorkoutStorage: createMemoryWorkoutStorage() };
});
jest.mock('@/workout/sqliteHistory', () => {
  const { createMemoryHistoryRepo } =
    jest.requireActual<typeof import('@/workout/history')>('@/workout/history');
  return { sqliteHistoryRepo: createMemoryHistoryRepo() };
});
jest.mock('@/exercises/sqliteRepo', () => {
  const { createMemoryRepo } =
    jest.requireActual<typeof import('@/exercises/repo')>('@/exercises/repo');
  return { sqliteLibraryRepo: createMemoryRepo() };
});
jest.mock('@/notifications/notifier', () => ({
  showOngoing: jest.fn(() => Promise.resolve()),
  dismiss: jest.fn(() => Promise.resolve()),
  scheduleRestEnd: jest.fn(() => Promise.resolve()),
  cancelRestEnd: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/haptics', () => ({ buzzDone: jest.fn() }));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismissAll: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
  useLocalSearchParams: jest.fn(() => ({})),
  usePathname: jest.fn(() => '/workout/active'),
  useFocusEffect: jest.fn(),
}));

const expoRouter = jest.requireMock<{
  router: Record<'push' | 'replace' | 'back' | 'dismissAll', jest.Mock>;
  useLocalSearchParams: jest.Mock;
}>('expo-router');
const history = jest.requireMock<{
  sqliteHistoryRepo: HistoryRepo & { workouts: (SavedWorkout & WorkoutExtras)[] };
}>('@/workout/sqliteHistory').sqliteHistoryRepo;
const library = jest.requireMock<{ sqliteLibraryRepo: LibraryRepo }>(
  '@/exercises/sqliteRepo',
).sqliteLibraryRepo;

const NOW = new Date(2026, 9, 27, 19, 5).getTime();
const STARTED = NOW - 60 * 60_000;
const HOUR = 3_600_000;

function benchSets(...sets: Parameters<typeof makeSet>[0][]): ActiveWorkout {
  return makeWorkout({
    id: 'w-today',
    title: 'Push',
    startedAt: STARTED,
    exercises: [
      makeWorkoutExercise({ exerciseId: BENCH.id, name: BENCH.name, sets: sets.map(makeSet) }),
    ],
  });
}

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

type Buttons = Parameters<typeof Alert.alert>[2];
function pressOn(label: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: Buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  resetAuthStoreForTests();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  useActiveWorkout.setState({ workout: null, restored: false, hydrated: true });
  useRestTimer.setState({ endsAt: null, totalS: 0, label: null });
  history.workouts.splice(0);
  await library.replaceMuscles(MUSCLES);
  await library.replaceEquipment(EQUIPMENT);
  await library.replaceExercises(EXERCISES);
});

describe('Finish button', () => {
  it('offers to discard a workout with nothing ticked', async () => {
    const alert = pressOn('Discard workout');
    useActiveWorkout.setState({ workout: benchSets({}) });
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText('Finish workout'));

    expect(alert.mock.calls[0]?.[0]).toBe('Nothing logged yet');
    expect(useActiveWorkout.getState().workout).toBeNull();
    expect(expoRouter.router.push).not.toHaveBeenCalled();
  });

  it('warns about unticked sets, then opens the finish screen', async () => {
    const alert = pressOn('Finish anyway');
    useActiveWorkout.setState({ workout: benchSets({ completed: true }, {}, {}) });
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText('Finish workout'));

    expect(alert.mock.calls[0]?.[0]).toBe('2 sets aren’t ticked');
    expect(expoRouter.router.push).toHaveBeenCalledWith('/workout/finish');
  });

  it('goes straight to the finish screen when every set is ticked', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    useActiveWorkout.setState({ workout: benchSets({ completed: true }) });
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText('Finish workout'));

    expect(alert).not.toHaveBeenCalled();
    expect(expoRouter.router.push).toHaveBeenCalledWith('/workout/finish');
  });
});

describe('Finish screen', () => {
  it('saves the edited workout on the device, offline, and shows the summary', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    useActiveWorkout.setState({
      workout: benchSets(
        { weightKg: 100, reps: 5, completed: true },
        { weightKg: 100, reps: 5, completed: false },
      ),
    });
    await show(<FinishWorkoutScreen />);

    expect(screen.getByText('500 kg')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('18:05')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('1:00')).toBeOnTheScreen();

    // Forgot to finish? Fix the duration. Typos are caught first.
    await fireEvent.changeText(screen.getByLabelText('Duration (h:mm)'), '50 min');
    await fireEvent.press(screen.getByLabelText('Save workout'));
    expect(screen.getByText('Use hours:minutes, like 1:05')).toBeOnTheScreen();
    expect(history.workouts).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Duration (h:mm)'), '0:50');
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Push day');
    await fireEvent.press(screen.getByLabelText('Who can see it: Followers'));
    await fireEvent.press(screen.getByLabelText('Save workout'));

    await waitFor(() => expect(expoRouter.router.push).toHaveBeenCalled());
    expect(expoRouter.router.dismissAll).toHaveBeenCalled();
    expect(expoRouter.router.push).toHaveBeenCalledWith({
      pathname: '/workout/summary',
      params: { id: 'w-today' },
    });
    expect(useActiveWorkout.getState().workout).toBeNull();
    const [saved] = history.workouts;
    expect(saved).toMatchObject({
      id: 'w-today',
      title: 'Push day',
      visibility: 'followers',
      startedAt: STARTED,
      endedAt: STARTED + 50 * 60_000,
      setCount: 1,
      volumeKg: 500,
      muscleSets: { chest: 1, front_delts: 0.5, triceps: 0.5 },
    });
    expect(saved?.exercises[0]?.sets).toHaveLength(1);
  });

  it("won't end in the future", async () => {
    useActiveWorkout.setState({ workout: benchSets({ completed: true }) });
    await show(<FinishWorkoutScreen />);

    await fireEvent.changeText(screen.getByLabelText('Duration (h:mm)'), '2:00');
    await fireEvent.press(screen.getByLabelText('Save workout'));

    expect(screen.getByText("The workout can't end in the future")).toBeOnTheScreen();
  });

  it('explains when there is no workout to finish', async () => {
    await show(<FinishWorkoutScreen />);

    expect(screen.getByText('No workout in progress.')).toBeOnTheScreen();
  });
});

describe('Summary', () => {
  async function saveBench(id: string, weightKg: number, startedAt: number) {
    const workout = { ...benchSets({ weightKg, reps: 5, completed: true }), id, startedAt };
    const saved = toSavedWorkout(workout, {
      title: 'Push',
      notes: '',
      startedAt,
      endedAt: startedAt + 65 * 60_000,
      visibility: 'public',
    });
    await saveFinishedWorkout(saved, EXERCISES, history);
  }

  it('celebrates new personal records', async () => {
    await saveBench('last-week', 100, STARTED - 7 * 24 * HOUR);
    await saveBench('w-today', 105, STARTED);
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'w-today' });
    await show(<WorkoutSummaryScreen />);

    expect(await screen.findByText('Workout complete')).toBeOnTheScreen();
    expect(screen.getByLabelText('4 new personal records')).toBeOnTheScreen();
    expect(screen.getByText('Heaviest weight: 105 kg (was 100 kg)')).toBeOnTheScreen();
    expect(screen.getByText('1 h 5 min')).toBeOnTheScreen();
    expect(screen.getByText('1 set · Best: 105 kg × 5')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Done'));
    expect(expoRouter.router.back).toHaveBeenCalled();
  });

  it('a first session sets baselines quietly', async () => {
    await saveBench('w-today', 100, STARTED);
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'w-today' });
    await show(<WorkoutSummaryScreen />);

    expect(await screen.findByText('Workout complete')).toBeOnTheScreen();
    expect(screen.queryByText(/personal record/)).toBeNull();
  });

  it('copes with an unknown workout', async () => {
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'nope' });
    await show(<WorkoutSummaryScreen />);

    expect(await screen.findByText('Workout not found.')).toBeOnTheScreen();
  });
});
