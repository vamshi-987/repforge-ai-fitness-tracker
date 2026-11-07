import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert } from 'react-native';

import type { LibraryRepo } from '@/exercises/repo';
import { useAuth } from '@/stores/auth';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { makeMe } from '@/test/helpers';
import { EQUIPMENT, EXERCISES, MUSCLES } from '@/test/library';
import { makeSet, makeWorkoutExercise } from '@/test/workouts';
import type { createMemoryHistoryRepo, SavedWorkout } from '@/workout/history';

import WorkoutDetailScreen from '../../app/history/[id]';
import WorkoutCalendarScreen from '../../app/history/calendar';
import EditWorkoutScreen from '../../app/history/edit';
import WorkoutHistoryScreen from '../../app/history/index';

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
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
}));

const history = jest.requireMock<{
  sqliteHistoryRepo: ReturnType<typeof createMemoryHistoryRepo>;
}>('@/workout/sqliteHistory').sqliteHistoryRepo;
const library = jest.requireMock<{ sqliteLibraryRepo: LibraryRepo }>(
  '@/exercises/sqliteRepo',
).sqliteLibraryRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;
const expoRouter = jest.requireMock<{
  useLocalSearchParams: jest.Mock;
  router: { push: jest.Mock; back: jest.Mock };
}>('expo-router');

const HOUR = 3_600_000;
const BENCH = 'Bench Press (Barbell)';

function benchWorkout(id: string, endedAt: number, weights: number[]): SavedWorkout {
  return {
    id,
    routineId: null,
    title: id === 'recent' ? 'Push Day' : 'Old Push',
    notes: '',
    startedAt: endedAt - HOUR,
    endedAt,
    visibility: 'public',
    volumeKg: weights.reduce((sum, w) => sum + w * 8, 0),
    setCount: weights.length,
    exercises: [
      makeWorkoutExercise({
        id: `${id}-bench`,
        sets: weights.map((weightKg, i) =>
          makeSet({ id: `${id}-s${i}`, weightKg, reps: 8, completed: true }),
        ),
      }),
    ],
  };
}

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  await history.clear();
  await outbox.clear();
  await library.replaceMuscles(MUSCLES);
  await library.replaceEquipment(EQUIPMENT);
  await library.replaceExercises(EXERCISES);
  const now = Date.now();
  await history.save(benchWorkout('recent', now - HOUR, [80, 82.5]), {
    muscleSets: {},
    records: [],
  });
  await history.save(benchWorkout('old', now - 3 * 24 * HOUR, [75]), {
    muscleSets: {},
    records: [],
  });
});

describe('Workout history', () => {
  it('lists workouts newest first and opens one', async () => {
    await show(<WorkoutHistoryScreen />);

    const rows = await screen.findAllByRole('button', { name: /Push/ });
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(['Push Day', 'Old Push']);
    expect(screen.getAllByText(BENCH).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByLabelText('Push Day'));
    expect(expoRouter.router.push).toHaveBeenCalledWith({
      pathname: '/history/[id]',
      params: { id: 'recent' },
    });
  });

  it('says so when there is nothing yet', async () => {
    await history.clear();
    await show(<WorkoutHistoryScreen />);

    expect(await screen.findByText(/No workouts yet/)).toBeOnTheScreen();
  });
});

describe('Workout detail', () => {
  it('shows every set and offers editing within 24 hours', async () => {
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'recent' });
    await show(<WorkoutDetailScreen />);

    expect(await screen.findByText('82.5 kg × 8')).toBeOnTheScreen();
    expect(screen.getByText('80 kg × 8')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Edit workout'));
    expect(expoRouter.router.push).toHaveBeenCalledWith({
      pathname: '/history/edit',
      params: { id: 'recent' },
    });
  });

  it('locks editing after 24 hours but still deletes', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'old' });
    await show(<WorkoutDetailScreen />);

    expect(await screen.findByText(/changed for 24 hours/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Edit workout')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Delete workout'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    expect(await history.load('old')).toBeNull();
    expect(outbox.items).toEqual([
      expect.objectContaining({ entity: 'workout', entityId: 'old', op: 'delete' }),
    ]);
  });
});

describe('Editing a workout', () => {
  it('changes weights and drops unticked sets', async () => {
    history.sync.set('recent', { version: 2, syncedAt: 1 });
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'recent' });
    await show(<EditWorkoutScreen />);

    await fireEvent.changeText(await screen.findByLabelText('Title'), 'Push Day (heavy)');
    await fireEvent.changeText(screen.getByLabelText(`${BENCH} set 1 weight`), '85');
    await fireEvent.press(screen.getByLabelText(`Complete ${BENCH} set 2`));
    await fireEvent.press(screen.getByLabelText('Save changes'));

    await waitFor(() => expect(expoRouter.router.back).toHaveBeenCalled());
    const saved = await history.load('recent');
    expect(saved).toMatchObject({ title: 'Push Day (heavy)', setCount: 1, volumeKg: 680 });
    expect(saved?.exercises[0]?.sets.map((s) => s.weightKg)).toEqual([85]);
    expect(outbox.items).toEqual([
      expect.objectContaining({ entityId: 'recent', op: 'upsert', baseVersion: 2 }),
    ]);
  });

  it('refuses to save a workout without a ticked set', async () => {
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'recent' });
    await show(<EditWorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText(`Complete ${BENCH} set 1`));
    await fireEvent.press(screen.getByLabelText(`Complete ${BENCH} set 2`));
    await fireEvent.press(screen.getByLabelText('Save changes'));

    expect(await screen.findByText(/Tick at least one set/)).toBeOnTheScreen();
    expect(outbox.items).toEqual([]);
  });

  it('refuses an edit once the 24 hours are over', async () => {
    expoRouter.useLocalSearchParams.mockReturnValue({ id: 'old' });
    await show(<EditWorkoutScreen />);

    await fireEvent.press(await screen.findByLabelText('Save changes'));

    expect(await screen.findByText(/only be changed for 24 hours/)).toBeOnTheScreen();
    expect(outbox.items).toEqual([]);
  });
});

describe('Calendar', () => {
  it('marks days with workouts and lists the chosen day', async () => {
    // The recent workout started 2 hours ago: near midnight or a month's end, that is
    // yesterday or last month.
    const started = new Date(Date.now() - 2 * HOUR);
    await show(<WorkoutCalendarScreen />);
    await screen.findByLabelText('Next month');
    if (started.getMonth() !== new Date().getMonth()) {
      await fireEvent.press(screen.getByLabelText('Previous month'));
    }
    const title = started.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const day = `${started.getDate()} ${title}: 1 workout`;

    await fireEvent.press(await screen.findByLabelText(day));
    expect(screen.getByLabelText('Push Day')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Next month'));
    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(screen.getByText('0 workouts')).toBeOnTheScreen();
  });
});
