import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { createMemoryNutritionRepo } from '@/nutrition/repo';
import { dayKey } from '@/nutrition/rules';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';
import { makeLog } from '@/test/nutrition';
import type { HistoryRepo, SavedWorkout } from '@/workout/history';

import HomeScreen from '../../app/(tabs)/home';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('@/api/nutrition', () => ({ getTargets: jest.fn() }));
jest.mock('@/api/social', () => ({
  getFeed: jest.fn(async () => ({ items: [], next_cursor: null })),
}));
jest.mock('@/workout/sqliteHistory', () => {
  const { createMemoryHistoryRepo } =
    jest.requireActual<typeof import('@/workout/history')>('@/workout/history');
  return { sqliteHistoryRepo: createMemoryHistoryRepo() };
});

const { router } = jest.requireMock<{ router: { navigate: jest.Mock } }>('expo-router');
const api = jest.requireMock<{ getTargets: jest.Mock }>('@/api/nutrition');
const nutrition = jest.requireMock<{
  sqliteNutritionRepo: ReturnType<typeof createMemoryNutritionRepo>;
}>('@/nutrition/sqliteRepo').sqliteNutritionRepo;
const history = jest.requireMock<{ sqliteHistoryRepo: HistoryRepo }>(
  '@/workout/sqliteHistory',
).sqliteHistoryRepo;

const NO_EXTRAS = { muscleSets: {}, records: [] };

function workout(id: string, startedAt: number): SavedWorkout {
  return {
    id,
    routineId: null,
    title: 'Push day',
    notes: '',
    startedAt,
    endedAt: startedAt + 3_600_000,
    visibility: 'private',
    volumeKg: 5000,
    setCount: 18,
    exercises: [],
  };
}

async function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  useAuth.setState({ status: 'signedIn', me: makeMe({ onboarding_complete: true }) });
  await nutrition.clear();
  await history.clear();
  api.getTargets.mockResolvedValue({
    effective_from: '2026-01-01',
    kcal: 2000,
    protein_g: 150,
    carbs_g: 200,
    fat_g: 60,
    reason: 'initial',
  });
});

describe('Home', () => {
  it('shows today’s calories and macros against the targets', async () => {
    await nutrition.putLog(makeLog({ log_date: dayKey(Date.now()) }));
    await nutrition.putLog(makeLog({ id: 'old', log_date: '2020-01-01' }));

    await show();

    await fireEvent.press(
      await screen.findByLabelText('Calories: 330 of 2000 kcal. Open nutrition'),
    );
    expect(screen.getByLabelText('Protein: 20 of 150 g')).toBeOnTheScreen();
    expect(router.navigate).toHaveBeenCalledWith('/nutrition');
    expect(screen.getByText('Estimates only, not medical advice.')).toBeOnTheScreen();
  });

  it('shows calories without targets before onboarding has the data', async () => {
    api.getTargets.mockRejectedValue(new Error('profile_incomplete'));

    await show();

    expect(await screen.findByLabelText('Calories: 0 kcal. Open nutrition')).toBeOnTheScreen();
    expect(screen.getByLabelText('Protein: 0 g')).toBeOnTheScreen();
  });

  it('shows whether today’s workout is done', async () => {
    await history.save(workout('yesterday', Date.now() - 2 * 86_400_000), NO_EXTRAS);
    await show();

    expect(
      await screen.findByLabelText('Workout: none yet today. Open workouts'),
    ).toBeOnTheScreen();
    expect(screen.getByText('To do')).toBeOnTheScreen();
  });

  it('counts the sets of today’s workouts and opens them', async () => {
    await history.save(workout('today', Date.now()), NO_EXTRAS);

    await show();

    await fireEvent.press(await screen.findByLabelText('Workout: 1 today, 18 sets. Open workouts'));
    expect(screen.getByText('Push day · 18 sets')).toBeOnTheScreen();
    expect(screen.getByText('Done')).toBeOnTheScreen();
    expect(router.navigate).toHaveBeenCalledWith('/workout');
  });
});
