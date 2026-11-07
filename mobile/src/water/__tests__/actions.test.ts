import type { WaterRepo } from '@/water/repo';
import type { OutboxItem, OutboxRepo } from '@/sync/outbox';
import { makeMe } from '@/test/helpers';
import { useAuth } from '@/stores/auth';

import { addWater, removeWater, syncWaterReminders } from '../actions';

jest.mock('@/notifications/notifier', () => ({
  replaceWaterReminders: jest.fn(async () => undefined),
}));
jest.mock('@/workout/sqliteHistory', () => {
  const { createMemoryHistoryRepo } =
    jest.requireActual<typeof import('@/workout/history')>('@/workout/history');
  return { sqliteHistoryRepo: createMemoryHistoryRepo() };
});

const notifier = jest.requireMock<{ replaceWaterReminders: jest.Mock }>('@/notifications/notifier');
const water = jest.requireMock<{ sqliteWaterRepo: WaterRepo }>(
  '@/water/sqliteRepo',
).sqliteWaterRepo;
const outbox = jest.requireMock<{ sqliteOutbox: OutboxRepo & { items: OutboxItem[] } }>(
  '@/sync/sqliteOutbox',
).sqliteOutbox;

const NOON = new Date(2026, 9, 30, 12, 0).getTime();

function signIn(reminders: boolean) {
  const me = makeMe({ onboarding_complete: true });
  useAuth.setState({
    status: 'signedIn',
    me: {
      ...me,
      profile: { ...me.profile, weight_kg: 80, water_goal_ml: null },
      settings: {
        ...me.settings,
        reminders_enabled: reminders,
        water_reminder_every_h: 2,
        wake_time: '07:00:00',
        sleep_time: '22:00:00',
      },
    },
  });
}

const reminded = () => notifier.replaceWaterReminders.mock.calls.at(-1)?.[0] as number[];
const todays = (times: number[]) => times.filter((t) => new Date(t).getDate() === 30);

beforeEach(async () => {
  jest.clearAllMocks();
  await water.clear();
  await outbox.clear();
});

describe('water actions', () => {
  it('logs offline, queues for the server and keeps reminders until the goal is met', async () => {
    signIn(true);

    const first = await addWater(1500, NOON);
    expect(todays(reminded()).length).toBeGreaterThan(0);

    await addWater(1300, NOON + 60_000);
    // 2800 ml reached (35 ml × 80 kg): nothing more today, tomorrow's stay.
    expect(todays(reminded())).toEqual([]);
    expect(reminded().length).toBeGreaterThan(0);

    await removeWater(first.id, NOON + 120_000);
    expect(todays(reminded()).length).toBeGreaterThan(0);
    expect(outbox.items.map((i) => [i.entity, i.op])).toEqual([
      ['water_log', 'delete'],
      ['water_log', 'upsert'],
    ]);
  });

  it('cancels every reminder when they are turned off', async () => {
    signIn(false);

    await syncWaterReminders(NOON);

    expect(notifier.replaceWaterReminders).toHaveBeenCalledWith([], '');
  });
});
