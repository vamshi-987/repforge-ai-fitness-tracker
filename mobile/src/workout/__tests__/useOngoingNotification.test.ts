import { act, renderHook } from '@testing-library/react-native';

import { useActiveWorkout } from '@/stores/activeWorkout';
import { makeWorkout } from '@/test/workouts';

import { ONGOING_NOTIFICATION_ID, useOngoingNotification } from '../useOngoingNotification';

jest.mock('@/workout/sqliteStorage', () => ({ sqliteWorkoutStorage: {} }));
jest.mock('@/notifications/notifier', () => ({
  showOngoing: jest.fn(() => Promise.resolve()),
  dismiss: jest.fn(() => Promise.resolve()),
}));

const notifier = jest.requireMock<{ showOngoing: jest.Mock; dismiss: jest.Mock }>(
  '@/notifications/notifier',
);

beforeEach(() => {
  jest.clearAllMocks();
  useActiveWorkout.setState({ workout: null });
});

describe('useOngoingNotification', () => {
  it('shows while a workout is in progress and clears after', async () => {
    await renderHook(() => useOngoingNotification());
    expect(notifier.showOngoing).not.toHaveBeenCalled();

    await act(async () => {
      useActiveWorkout.getState().start(makeWorkout({ title: 'Push' }));
    });
    expect(notifier.showOngoing).toHaveBeenCalledWith(
      ONGOING_NOTIFICATION_ID,
      'Push',
      expect.stringMatching(/^Workout in progress since .+\. Tap to open\.$/),
    );

    // Typing in the workout doesn't re-post it.
    await act(async () => {
      useActiveWorkout.getState().update((w) => ({ ...w, title: 'Push A' }));
    });
    expect(notifier.showOngoing).toHaveBeenCalledTimes(1);

    await act(async () => useActiveWorkout.getState().end());
    expect(notifier.dismiss).toHaveBeenLastCalledWith(ONGOING_NOTIFICATION_ID);
  });
});
