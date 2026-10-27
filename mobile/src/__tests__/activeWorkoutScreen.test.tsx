import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import { MiniWorkoutBar } from '@/components/workout/MiniWorkoutBar';
import { exercisePicker } from '@/exercises/picker';
import { useActiveWorkout } from '@/stores/activeWorkout';
import { resetAuthStoreForTests, useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';
import { makeExercise } from '@/test/library';
import { makeRoutine } from '@/test/routines';
import { makeSet, makeWorkoutExercise } from '@/test/workouts';
import type { HistoryRepo, SavedWorkout } from '@/workout/history';
import { startEmpty, startFromRoutine } from '@/workout/model';
import type { ActiveWorkout } from '@/workout/types';

import ActiveWorkoutScreen from '../../app/(tabs)/workout/active';

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
jest.mock('@/notifications/notifier', () => ({
  showOngoing: jest.fn(() => Promise.resolve()),
  dismiss: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  usePathname: jest.fn(() => '/home'),
  useFocusEffect: jest.fn((effect: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(effect, [effect]);
  }),
}));

const expoRouter = jest.requireMock<{
  router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock; canGoBack: jest.Mock };
  usePathname: jest.Mock;
}>('expo-router');
const keepAwake = jest.requireMock<{ activateKeepAwakeAsync: jest.Mock }>('expo-keep-awake');
const history = jest.requireMock<{ sqliteHistoryRepo: HistoryRepo & { workouts: SavedWorkout[] } }>(
  '@/workout/sqliteHistory',
).sqliteHistoryRepo;

const NOW = Date.UTC(2026, 9, 27, 18, 30, 0);
const BENCH = 'Bench Press (Barbell)';
const PUSH_UP = makeExercise({ name: 'Push-Up', type: 'bodyweight_reps', equipment: 'bodyweight' });

function lastSession(): SavedWorkout {
  const exercise = makeWorkoutExercise({
    exerciseId: makeRoutine({ name: 'x' }).exercises[0]?.exercise_id ?? '',
    sets: [
      makeSet({ type: 'warmup', weightKg: 40, reps: 10, completed: true }),
      makeSet({ weightKg: 62.5, reps: 8, completed: true }),
      makeSet({ weightKg: 62.5, reps: 6, completed: true }),
    ],
  });
  return {
    id: 'last',
    routineId: null,
    title: 'Last push',
    notes: '',
    startedAt: NOW - 3 * 86_400_000,
    endedAt: NOW - 3 * 86_400_000 + 3_600_000,
    visibility: 'public',
    volumeKg: 1625,
    setCount: 3,
    exercises: [exercise],
  };
}

function routineWorkout(): ActiveWorkout {
  let n = 0;
  return startFromRoutine(makeRoutine({ name: 'Push' }), () => `id-${++n}`, NOW - 5 * 60_000);
}

function begin(workout: ActiveWorkout) {
  useActiveWorkout.setState({ workout, restored: false, hydrated: true });
}

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const workout = () => useActiveWorkout.getState().workout;
const firstSets = () => workout()?.exercises[0]?.sets ?? [];

type Buttons = Parameters<typeof Alert.alert>[2];
function pressOn(label: string) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons: Buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  resetAuthStoreForTests();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  useActiveWorkout.setState({ workout: null, restored: false, hydrated: true });
  history.workouts.splice(0, history.workouts.length, lastSession());
  expoRouter.usePathname.mockReturnValue('/home');
});

describe('Active workout screen', () => {
  it('offers to start one when nothing is in progress', async () => {
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText('Start empty workout'));

    expect(workout()).toMatchObject({ startedAt: NOW, exercises: [] });
    expect(expoRouter.router.push).toHaveBeenCalledWith('/workout/active');
  });

  it('shows the live duration, last session and running totals', async () => {
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);

    expect(screen.getByLabelText('Duration 00:05:00')).toBeOnTheScreen();
    expect(await screen.findByLabelText(`${BENCH} set 1 previous: 62.5 kg × 8`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${BENCH} warm-up set previous: 40 kg × 10`)).toBeOnTheScreen();
    expect(screen.getByText('0 / 3')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText(`Complete ${BENCH} set 1`));

    expect(firstSets()[1]?.completed).toBe(true);
    expect(screen.getByText('1 / 3')).toBeOnTheScreen();
    expect(screen.getByText('480 kg')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText(`Complete ${BENCH} set 1`));
    expect(firstSets()[1]?.completed).toBe(false);
  });

  it('ticking an empty set takes last session’s values', async () => {
    const empty = startEmpty('w', NOW);
    begin({
      ...empty,
      exercises: [
        makeWorkoutExercise({ sets: [makeSet({ type: 'warmup', weightKg: null, reps: null })] }),
      ],
    });
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText(`Complete ${BENCH} warm-up set`));

    expect(firstSets()[0]).toMatchObject({ weightKg: 40, reps: 10, completed: true });
  });

  it('copies last session into a set from the Previous column', async () => {
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText(`${BENCH} set 2 previous: 62.5 kg × 6`));

    expect(firstSets()[2]).toMatchObject({ weightKg: 62.5, reps: 6, completed: false });
  });

  it('asks for reps before ticking a set with nothing to go on', async () => {
    history.workouts.splice(0);
    begin({
      ...startEmpty('w', NOW),
      exercises: [makeWorkoutExercise({ sets: [makeSet({ reps: null })] })],
    });
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText(`Complete ${BENCH} set 1`));

    expect(screen.getByText('Enter the reps to complete set 1.')).toBeOnTheScreen();
    expect(firstSets()[0]?.completed).toBe(false);
  });

  it('changes set type and RPE from the set menu', async () => {
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText(`${BENCH} set 2 options`));
    await fireEvent.press(screen.getByLabelText('Drop set'));
    expect(firstSets()[2]?.type).toBe('drop');

    await fireEvent.press(screen.getByLabelText(`${BENCH} set 1 options`));
    await fireEvent.press(screen.getByLabelText('Rate effort (RPE)'));
    await fireEvent.press(screen.getByLabelText('RPE 8.5'));
    expect(firstSets()[1]?.rpe).toBe(8.5);
    expect(screen.getByText('@8.5')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText(`${BENCH} set 1 options`));
    await fireEvent.press(screen.getByLabelText('Remove set'));
    expect(firstSets()).toHaveLength(2);
  });

  it('takes weights in pounds and stores kg', async () => {
    const me = makeMe({ onboarding_complete: true });
    useAuth.setState({ me: { ...me, profile: { ...me.profile, unit_weight: 'lb' } } });
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);

    expect(screen.getByText('lb')).toBeOnTheScreen();
    expect(screen.getByLabelText(`${BENCH} set 1 weight`)).toHaveDisplayValue('132.3');
    await fireEvent.changeText(screen.getByLabelText(`${BENCH} set 1 weight`), '135');

    expect(firstSets()[1]?.weightKg).toBe(61.23);
  });

  it('adds sets and exercises, and renames the workout', async () => {
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText(`Add set to ${BENCH}`));
    expect(firstSets()).toHaveLength(4);

    await fireEvent.press(screen.getByLabelText('Add exercises'));
    expect(expoRouter.router.push).toHaveBeenCalledWith('/exercise-picker');
    exercisePicker.deliver([PUSH_UP]);
    expect(await screen.findByLabelText('Push-Up set 1 reps')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Push-Up set 1 weight')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Workout title'), 'Heavy push');
    expect(workout()?.title).toBe('Heavy push');
  });

  it('confirms before removing an exercise with logged sets', async () => {
    const alert = pressOn('Remove');
    const routine = routineWorkout();
    begin({
      ...routine,
      exercises: routine.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s, i) => ({ ...s, completed: i === 0 })),
      })),
    });
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText(`${BENCH} options`));
    await fireEvent.press(screen.getByLabelText('Remove exercise'));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(workout()?.exercises).toEqual([]);
    expect(screen.getByText('Add an exercise to start logging sets.')).toBeOnTheScreen();
  });

  it('discards after confirming', async () => {
    pressOn('Discard');
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText('Discard workout'));

    expect(workout()).toBeNull();
    expect(expoRouter.router.back).toHaveBeenCalled();
  });

  it('keeps the screen awake unless turned off in Settings', async () => {
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);
    expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1);

    keepAwake.activateKeepAwakeAsync.mockClear();
    const me = makeMe({ onboarding_complete: true });
    useAuth.setState({ me: { ...me, settings: { ...me.settings, keep_awake: false } } });
    await show(<ActiveWorkoutScreen />);
    expect(keepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();
  });

  it('minimizes back to where it came from', async () => {
    begin(routineWorkout());
    await show(<ActiveWorkoutScreen />);

    await fireEvent.press(screen.getByLabelText('Minimize workout'));
    expect(expoRouter.router.back).toHaveBeenCalled();

    expoRouter.router.canGoBack.mockReturnValueOnce(false);
    await fireEvent.press(screen.getByLabelText('Minimize workout'));
    expect(expoRouter.router.replace).toHaveBeenCalledWith('/workout');
  });
});

describe('Mini workout bar', () => {
  it('is hidden without a workout', async () => {
    await show(<MiniWorkoutBar />);

    expect(screen.queryByLabelText(/Workout in progress/)).toBeNull();
  });

  it('shows the workout, its time and the next set, and opens it', async () => {
    begin(routineWorkout());
    await show(<MiniWorkoutBar />);

    const bar = screen.getByLabelText('Workout in progress: Push, 00:05:00. Open it.');
    expect(screen.getByText(`${BENCH} · Warm-up set`)).toBeOnTheScreen();
    await fireEvent.press(bar);
    expect(expoRouter.router.push).toHaveBeenCalledWith('/workout/active');
  });

  it('says when every set is done', async () => {
    const routine = routineWorkout();
    begin({
      ...routine,
      exercises: routine.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => ({ ...s, completed: true })),
      })),
    });
    await show(<MiniWorkoutBar />);

    expect(screen.getByText('All sets done')).toBeOnTheScreen();
  });

  it('steps aside on the workout screen itself', async () => {
    expoRouter.usePathname.mockReturnValue('/workout/active');
    begin(routineWorkout());
    await show(<MiniWorkoutBar />);

    await waitFor(() => expect(screen.queryByLabelText(/Workout in progress/)).toBeNull());
  });
});
