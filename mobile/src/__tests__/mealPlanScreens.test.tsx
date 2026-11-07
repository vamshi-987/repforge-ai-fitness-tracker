import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { PlannedMeal } from '@/api/types';
import type { createMemoryNutritionRepo } from '@/nutrition/repo';
import { dayKey } from '@/nutrition/rules';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/helpers';
import { makeLog } from '@/test/nutrition';

import NutritionScreen from '../../app/(tabs)/nutrition/index';
import PlannedMealScreen from '../../app/(tabs)/nutrition/plan';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('@/api/nutrition', () => ({ getTargets: jest.fn(async () => null) }));
jest.mock('@/settings/actions', () => ({ saveSettings: jest.fn(async () => true) }));

const expoRouter = jest.requireMock<{
  router: { push: jest.Mock; back: jest.Mock };
  useLocalSearchParams: jest.Mock;
}>('expo-router');
const { router } = expoRouter;
const settingsActions = jest.requireMock<{ saveSettings: jest.Mock }>('@/settings/actions');
const repo = jest.requireMock<{
  sqliteNutritionRepo: ReturnType<typeof createMemoryNutritionRepo>;
}>('@/nutrition/sqliteRepo').sqliteNutritionRepo;

const PLAN: PlannedMeal[] = [
  { name: 'Breakfast', time: '08:00' },
  { name: 'Dinner', time: '20:00' },
];

function signIn(plan: PlannedMeal[]) {
  const me = makeMe({ onboarding_complete: true });
  useAuth.setState({
    status: 'signedIn',
    me: { ...me, settings: { ...me.settings, meal_plan: plan } },
  });
}

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  expoRouter.useLocalSearchParams.mockReturnValue({});
  repo.logs.splice(0, repo.logs.length);
  signIn(PLAN);
});

describe('The Nutrition tab', () => {
  it('lists the plan and opens a meal to edit, or a new one', async () => {
    await show(<NutritionScreen />);

    await fireEvent.press(await screen.findByLabelText('Edit Dinner'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/nutrition/plan',
      params: { index: '1' },
    });

    await fireEvent.press(screen.getByLabelText('Add a planned meal'));
    expect(router.push).toHaveBeenCalledWith('/nutrition/plan');
  });

  it('invites you to plan when there’s nothing yet, even on an older cached profile', async () => {
    const me = makeMe({ onboarding_complete: true });
    const older = { ...me.settings } as Partial<typeof me.settings>;
    delete older.meal_plan;
    useAuth.setState({ me: { ...me, settings: older as typeof me.settings } });
    await show(<NutritionScreen />);

    expect(await screen.findByText(/Add your meals and their times/)).toBeOnTheScreen();
  });

  it('counts food towards the day with no meals to pick from', async () => {
    await repo.putLog(makeLog({ log_date: dayKey(Date.now()), name: 'Dal', meal: 'lunch' }));
    await repo.putLog(
      makeLog({ id: 'log-2', log_date: dayKey(Date.now()), name: 'Eggs', meal: 'breakfast' }),
    );
    await show(<NutritionScreen />);

    expect(await screen.findByLabelText('Edit Dal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Edit Eggs')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Add to Lunch')).toBeNull();
    expect(screen.queryByText('Lunch')).toBeNull();
  });
});

describe('A planned meal', () => {
  it('adds a meal in the day’s order', async () => {
    await show(<PlannedMealScreen />);

    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Pre-workout');
    await fireEvent.changeText(screen.getByLabelText('Time'), '5pm');
    await fireEvent.press(screen.getByLabelText('Save meal'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(settingsActions.saveSettings).toHaveBeenCalledWith({
      meal_plan: [PLAN[0], { name: 'Pre-workout', time: '17:00' }, PLAN[1]],
    });
  });

  it('edits a meal, moving it if its time changes', async () => {
    expoRouter.useLocalSearchParams.mockReturnValue({ index: '0' });
    await show(<PlannedMealScreen />);

    expect(screen.getByLabelText('Meal name')).toHaveProp('value', 'Breakfast');
    await fireEvent.changeText(screen.getByLabelText('Time'), '21:00');
    await fireEvent.press(screen.getByLabelText('Save meal'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(settingsActions.saveSettings).toHaveBeenCalledWith({
      meal_plan: [PLAN[1], { name: 'Breakfast', time: '21:00' }],
    });
  });

  it('removes a meal', async () => {
    expoRouter.useLocalSearchParams.mockReturnValue({ index: '0' });
    await show(<PlannedMealScreen />);

    await fireEvent.press(screen.getByLabelText('Remove from plan'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(settingsActions.saveSettings).toHaveBeenCalledWith({ meal_plan: [PLAN[1]] });
  });

  it('refuses a bad time, and stays put when saving fails', async () => {
    await show(<PlannedMealScreen />);

    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Snack');
    await fireEvent.changeText(screen.getByLabelText('Time'), 'later');
    await fireEvent.press(screen.getByLabelText('Save meal'));
    expect(await screen.findByText(/Use a time like/)).toBeOnTheScreen();
    expect(settingsActions.saveSettings).not.toHaveBeenCalled();

    settingsActions.saveSettings.mockResolvedValueOnce(false);
    await fireEvent.changeText(screen.getByLabelText('Time'), '16:00');
    await fireEvent.press(screen.getByLabelText('Save meal'));
    expect(await screen.findByText(/Couldn’t save your plan/)).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('stops at the limit', async () => {
    signIn(Array.from({ length: 12 }, (_, i) => ({ name: `Meal ${i}`, time: '08:00' })));
    await show(<PlannedMealScreen />);

    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'One more');
    await fireEvent.changeText(screen.getByLabelText('Time'), '9');
    await fireEvent.press(screen.getByLabelText('Save meal'));

    expect(await screen.findByText(/up to 12 meals/)).toBeOnTheScreen();
    expect(settingsActions.saveSettings).not.toHaveBeenCalled();
  });
});
