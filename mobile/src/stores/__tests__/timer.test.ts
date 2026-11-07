import { mockStores } from '@/test/helpers';

import { useRestTimer } from '../timer';

jest.mock('@/notifications/notifier', () => ({
  scheduleRestEnd: jest.fn(() => Promise.resolve()),
  cancelRestEnd: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/haptics', () => ({ buzzDone: jest.fn() }));

const notifier = jest.requireMock<{ scheduleRestEnd: jest.Mock; cancelRestEnd: jest.Mock }>(
  '@/notifications/notifier',
);
const haptics = jest.requireMock<{ buzzDone: jest.Mock }>('@/lib/haptics');
const T = 1_800_000_000_000;
const saved = () => mockStores().kv.get('repforge.restTimer');
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockStores().kv.clear();
  useRestTimer.setState({ endsAt: null, totalS: 0, label: null });
});

describe('rest timer', () => {
  it('starts with an end time and a notification for it', async () => {
    useRestTimer.getState().start(90, 'Bench Press', T);
    await flush();

    expect(useRestTimer.getState()).toMatchObject({
      endsAt: T + 90_000,
      totalS: 90,
      label: 'Bench Press',
    });
    expect(notifier.scheduleRestEnd).toHaveBeenCalledWith(
      T + 90_000,
      'Time for your next set of Bench Press.',
    );
    expect(JSON.parse(saved() ?? 'null')).toEqual({
      endsAt: T + 90_000,
      totalS: 90,
      label: 'Bench Press',
    });
  });

  it('adds and takes away 15 s, rescheduling the notification', () => {
    useRestTimer.getState().start(90, 'Row', T);

    useRestTimer.getState().adjust(15, T + 10_000);
    expect(useRestTimer.getState()).toMatchObject({ endsAt: T + 105_000, totalS: 105 });
    useRestTimer.getState().adjust(-15, T + 10_000);
    expect(useRestTimer.getState()).toMatchObject({ endsAt: T + 90_000, totalS: 90 });
    expect(notifier.scheduleRestEnd).toHaveBeenLastCalledWith(T + 90_000, expect.any(String));
  });

  it('stops when −15 leaves nothing', async () => {
    useRestTimer.getState().start(20, 'Row', T);

    useRestTimer.getState().adjust(-15, T + 10_000);
    await flush();

    expect(useRestTimer.getState().endsAt).toBeNull();
    expect(notifier.cancelRestEnd).toHaveBeenCalled();
    expect(saved()).toBeUndefined();
  });

  it('skips without buzzing; expiring buzzes', () => {
    useRestTimer.getState().start(60, 'Row', T);
    useRestTimer.getState().skip();
    expect(haptics.buzzDone).not.toHaveBeenCalled();
    expect(notifier.cancelRestEnd).toHaveBeenCalledTimes(1);

    useRestTimer.getState().start(60, 'Row', T);
    useRestTimer.getState().expire();
    expect(haptics.buzzDone).toHaveBeenCalledTimes(1);
    expect(useRestTimer.getState().endsAt).toBeNull();

    // Nothing running: nothing to do.
    useRestTimer.getState().expire();
    useRestTimer.getState().skip();
    useRestTimer.getState().adjust(15, T);
    expect(haptics.buzzDone).toHaveBeenCalledTimes(1);
    expect(notifier.cancelRestEnd).toHaveBeenCalledTimes(2);
  });

  it('picks up a running rest after the app was killed', async () => {
    mockStores().kv.set(
      'repforge.restTimer',
      JSON.stringify({ endsAt: T + 40_000, totalS: 90, label: 'Squat' }),
    );

    await useRestTimer.getState().restore(T);

    expect(useRestTimer.getState()).toMatchObject({ endsAt: T + 40_000, label: 'Squat' });
  });

  it('forgets a rest that ended while the app was closed, or a corrupt one', async () => {
    mockStores().kv.set(
      'repforge.restTimer',
      JSON.stringify({ endsAt: T - 1, totalS: 90, label: 'Squat' }),
    );
    await useRestTimer.getState().restore(T);
    await flush();
    expect(useRestTimer.getState().endsAt).toBeNull();
    expect(saved()).toBeUndefined();

    mockStores().kv.set('repforge.restTimer', '{not json');
    await useRestTimer.getState().restore(T);
    await flush();
    expect(saved()).toBeUndefined();
  });
});
