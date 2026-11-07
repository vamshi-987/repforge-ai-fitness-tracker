import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { useAuth } from '@/stores/auth';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { makeMe } from '@/test/helpers';
import type { WaterRepo } from '@/water/repo';

import HomeScreen from '../../app/(tabs)/home';
import WaterScreen from '../../app/water';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/api/nutrition', () => ({ getTargets: jest.fn(async () => null) }));
jest.mock('@/api/social', () => ({
  getFeed: jest.fn(async () => ({ items: [], next_cursor: null })),
}));
jest.mock('@/notifications/notifier', () => ({
  replaceWaterReminders: jest.fn(async () => undefined),
}));
jest.mock('@/workout/sqliteHistory', () => {
  const { createMemoryHistoryRepo } =
    jest.requireActual<typeof import('@/workout/history')>('@/workout/history');
  return { sqliteHistoryRepo: createMemoryHistoryRepo() };
});
jest.mock('@/settings/actions', () => ({
  saveSettings: jest.fn(async () => true),
  saveWaterGoal: jest.fn(async () => true),
}));

const water = jest.requireMock<{ sqliteWaterRepo: WaterRepo }>(
  '@/water/sqliteRepo',
).sqliteWaterRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;
const notifier = jest.requireMock<{ replaceWaterReminders: jest.Mock }>('@/notifications/notifier');
const settingsActions = jest.requireMock<{ saveSettings: jest.Mock; saveWaterGoal: jest.Mock }>(
  '@/settings/actions',
);
const expoRouter = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');

function signIn() {
  const me = makeMe({ onboarding_complete: true });
  useAuth.setState({
    status: 'signedIn',
    me: {
      ...me,
      profile: { ...me.profile, weight_kg: 60, water_goal_ml: null },
      settings: {
        ...me.settings,
        water_cup_sizes: [250, 500, 750],
        reminders_enabled: true,
        water_reminder_every_h: 2,
        wake_time: '00:00:00',
        sleep_time: '23:59:00',
      },
    },
  });
}

async function show(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const todayStart = () => new Date(new Date().setHours(0, 0, 0, 0)).getDate();

beforeEach(async () => {
  jest.clearAllMocks();
  signIn();
  await water.clear();
  await outbox.clear();
});

describe('Water', () => {
  it('adds a cup offline, queues it, and offers an undo', async () => {
    await show(<WaterScreen />);

    // 35 ml × 60 kg = 2100 ml.
    expect(await screen.findByLabelText('Water today: 0 of 2100 ml')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Add 500 ml'));

    expect(await screen.findByLabelText('Water today: 500 of 2100 ml')).toBeOnTheScreen();
    expect(screen.getByText('1600 ml to go')).toBeOnTheScreen();
    expect(outbox.items).toEqual([
      expect.objectContaining({
        entity: 'water_log',
        op: 'upsert',
        data: expect.objectContaining({ amount_ml: 500 }),
      }),
    ]);

    await fireEvent.press(screen.getByLabelText('Undo'));
    expect(await screen.findByLabelText('Water today: 0 of 2100 ml')).toBeOnTheScreen();
    expect(outbox.items.map((i) => i.op)).toEqual(['delete']);
  });

  it('stops today’s reminders once the goal is reached', async () => {
    await show(<WaterScreen />);

    await fireEvent.press(await screen.findByLabelText('Add 750 ml'));
    await waitFor(() => expect(notifier.replaceWaterReminders).toHaveBeenCalled());
    const before = notifier.replaceWaterReminders.mock.calls.at(-1)?.[0] as number[];
    await fireEvent.press(screen.getByLabelText('Add 750 ml'));
    await fireEvent.press(screen.getByLabelText('Add 750 ml'));

    expect(await screen.findByText(/Goal reached/)).toBeOnTheScreen();
    const after = notifier.replaceWaterReminders.mock.calls.at(-1)?.[0] as number[];
    const today = (times: number[]) => times.filter((t) => new Date(t).getDate() === todayStart());
    expect(after.length).toBeGreaterThan(0);
    expect(today(after)).toEqual([]);
    // Before the goal, today's remaining slots were scheduled (unless the day is nearly over).
    expect(today(before).length).toBeGreaterThanOrEqual(today(after).length);
  });

  it('adds another amount and changes a cup size', async () => {
    await show(<WaterScreen />);

    await fireEvent.press(await screen.findByLabelText('Other amount'));
    await fireEvent.changeText(screen.getByLabelText('Amount (ml)'), '330');
    await fireEvent.press(screen.getByLabelText('Add'));
    expect(await screen.findByLabelText('Water today: 330 of 2100 ml')).toBeOnTheScreen();

    await fireEvent(screen.getByLabelText('Add 250 ml'), 'longPress');
    await fireEvent.changeText(screen.getByLabelText('Amount (ml)'), '300');
    await fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() =>
      expect(settingsActions.saveSettings).toHaveBeenCalledWith({
        water_cup_sizes: [300, 500, 750],
      }),
    );
  });

  it('sets your own daily goal and plans the reminders again', async () => {
    await show(<WaterScreen />);

    await fireEvent.press(await screen.findByLabelText('Change daily goal'));
    expect(screen.getByLabelText('Goal (ml)')).toHaveProp('value', '2100');
    await fireEvent.changeText(screen.getByLabelText('Goal (ml)'), '3200');
    await fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(settingsActions.saveWaterGoal).toHaveBeenCalledWith(3200));
    await waitFor(() => expect(notifier.replaceWaterReminders).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText('Goal (ml)')).toBeNull());
  });

  it('refuses a goal out of range, and keeps the dialog open when saving fails', async () => {
    await show(<WaterScreen />);

    await fireEvent.press(await screen.findByLabelText('Change daily goal'));
    await fireEvent.changeText(screen.getByLabelText('Goal (ml)'), '100');
    await fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByText(/500–10000 ml/)).toBeOnTheScreen();
    expect(settingsActions.saveWaterGoal).not.toHaveBeenCalled();

    settingsActions.saveWaterGoal.mockResolvedValueOnce(false);
    await fireEvent.changeText(screen.getByLabelText('Goal (ml)'), '3000');
    await fireEvent.press(screen.getByLabelText('Save'));
    expect(await screen.findByText(/Couldn’t save your goal/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Goal (ml)')).toBeOnTheScreen();
  });

  it('shows your own goal, and goes back to the recommended one', async () => {
    const me = useAuth.getState().me!;
    useAuth.setState({ me: { ...me, profile: { ...me.profile, water_goal_ml: 3000 } } });
    await show(<WaterScreen />);

    expect(await screen.findByLabelText('Water today: 0 of 3000 ml')).toBeOnTheScreen();
    expect(screen.getByText(/Your own goal/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Use recommended goal'));
    await waitFor(() => expect(settingsActions.saveWaterGoal).toHaveBeenCalledWith(null));
  });

  it('offers no reset while the goal is the recommended one', async () => {
    await show(<WaterScreen />);

    expect(await screen.findByLabelText('Change daily goal')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Use recommended goal')).toBeNull();
  });

  it('refuses an implausible amount', async () => {
    await show(<WaterScreen />);

    await fireEvent.press(await screen.findByLabelText('Other amount'));
    await fireEvent.changeText(screen.getByLabelText('Amount (ml)'), '9000');
    await fireEvent.press(screen.getByLabelText('Add'));

    expect(await screen.findByText(/50–2000 ml/)).toBeOnTheScreen();
    expect(outbox.items).toEqual([]);
  });
});

describe('Home', () => {
  it('shows the water ring and opens the water screen', async () => {
    await water.put({
      id: 'w',
      logged_at: new Date().toISOString(),
      amount_ml: 1050,
      version: 1,
      created_at: '',
      updated_at: '',
    });
    await show(<HomeScreen />);

    await fireEvent.press(await screen.findByLabelText('Water: 1050 of 2100 ml. Open water'));

    expect(screen.getByText('50%')).toBeOnTheScreen();
    expect(expoRouter.router.push).toHaveBeenCalledWith('/water');
  });
});
