import { act, renderHook } from '@testing-library/react-native';

import { useActiveWorkout } from '@/stores/activeWorkout';
import { useRestTimer } from '@/stores/timer';
import { makeWorkout } from '@/test/workouts';

import { useRestTimerEffects } from '../useRestTimerEffects';

jest.mock('@/workout/sqliteStorage', () => ({ sqliteWorkoutStorage: {} }));
jest.mock('@/notifications/notifier', () => ({
  scheduleRestEnd: jest.fn(() => Promise.resolve()),
  cancelRestEnd: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/haptics', () => ({ buzzDone: jest.fn() }));

const haptics = jest.requireMock<{ buzzDone: jest.Mock }>('@/lib/haptics');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-27T18:00:00Z'));
  jest.clearAllMocks();
  useRestTimer.setState({ endsAt: null, totalS: 0, label: null });
  useActiveWorkout.setState({ workout: makeWorkout() });
});
afterEach(() => jest.useRealTimers());

describe('useRestTimerEffects', () => {
  it('buzzes and stops when rest runs out in the foreground', async () => {
    await renderHook(() => useRestTimerEffects());

    await act(async () => useRestTimer.getState().start(2, 'Row', Date.now()));
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(useRestTimer.getState().endsAt).not.toBeNull();

    await act(() => jest.advanceTimersByTimeAsync(1500));
    expect(useRestTimer.getState().endsAt).toBeNull();
    expect(haptics.buzzDone).toHaveBeenCalledTimes(1);
  });

  it('stops the rest when the workout ends', async () => {
    await renderHook(() => useRestTimerEffects());
    await act(async () => useRestTimer.getState().start(90, 'Row', Date.now()));

    await act(async () => useActiveWorkout.getState().end());

    expect(useRestTimer.getState().endsAt).toBeNull();
    expect(haptics.buzzDone).not.toHaveBeenCalled();
  });
});
